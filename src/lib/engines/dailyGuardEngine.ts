import type { Account, GuardStatus, Trade, TradingRules } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import { drawdownBuffer } from './propRuleEngine';

export interface CooldownState {
  active: boolean;
  endsAt: string | null;
  remainingMs: number;
  /** Total cooldown length in ms, for progress display. */
  totalMs: number;
}

export interface DailyGuard {
  status: GuardStatus;
  headline: string;
  reasons: string[];
  balance: number;
  /** Effective daily loss budget: the tighter of account limit and personal daily stop. */
  dailyLimit: number;
  realizedPnlToday: number;
  /** Realized loss today plus risk on open positions. */
  riskUsed: number;
  riskRemaining: number;
  riskUsedPct: number;
  tradesTaken: number;
  maxTrades: number;
  tradesRemaining: number;
  consecutiveLosses: number;
  cooldown: CooldownState;
  drawdownBuffer: number | null;
  maxContracts: number | null;
  openTrades: number;
}

export interface DailyGuardInput {
  account: Account;
  rules: TradingRules;
  trades: Trade[];
  now?: Date;
}

const CAUTION_RISK_PCT = 0.6;

function sortByTime(trades: Trade[]): Trade[] {
  return [...trades].sort(
    (a, b) => Date.parse(a.closedAt ?? a.openedAt) - Date.parse(b.closedAt ?? b.openedAt),
  );
}

/** Trailing count of consecutive losing closed trades (today only). */
export function consecutiveLosses(todaysClosed: Trade[]): number {
  let n = 0;
  const sorted = sortByTime(todaysClosed);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const pnl = sorted[i].pnl ?? 0;
    if (pnl < 0) n++;
    else break;
  }
  return n;
}

export function computeCooldown(todaysClosed: Trade[], rules: TradingRules, now: Date): CooldownState {
  const totalMs = Math.max(0, rules.cooldownMinutes) * 60_000;
  const idle: CooldownState = { active: false, endsAt: null, remainingMs: 0, totalMs };
  if (totalMs === 0 || !rules.noRevengeTrades) return idle;
  const losses = todaysClosed.filter((t) => (t.pnl ?? 0) < 0 && t.closedAt);
  if (losses.length === 0) return idle;
  const last = sortByTime(losses)[losses.length - 1];
  const ends = Date.parse(last.closedAt!) + totalMs;
  const remaining = ends - now.getTime();
  if (remaining <= 0) return { ...idle, endsAt: new Date(ends).toISOString() };
  return { active: true, endsAt: new Date(ends).toISOString(), remainingMs: remaining, totalMs };
}

/**
 * The Daily Guard answers one question: is it safe to keep trading today?
 * It is intentionally conservative and never suggests taking more risk.
 */
export function computeDailyGuard({ account, rules, trades, now = new Date() }: DailyGuardInput): DailyGuard {
  const today = dayKey(now);
  const accountTrades = trades.filter((t) => t.accountId === account.id && t.status !== 'cancelled');
  const todays = accountTrades.filter((t) => dayKey(t.openedAt) === today);
  const todaysClosed = todays.filter((t) => t.status === 'closed');
  const open = todays.filter((t) => t.status === 'open');

  const limits = [rules.dailyStop, account.rules.dailyLossLimit].filter(
    (v): v is number => typeof v === 'number' && v > 0,
  );
  const dailyLimit = limits.length > 0 ? Math.min(...limits) : 0;

  const realizedPnlToday = todaysClosed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const openRisk = open.reduce((s, t) => s + t.riskDollars, 0);
  const riskUsed = Math.max(0, -realizedPnlToday) + openRisk;
  const riskRemaining = Math.max(0, dailyLimit - riskUsed);
  const riskUsedPct = dailyLimit > 0 ? Math.min(1, riskUsed / dailyLimit) : 0;

  const tradesTaken = todays.length;
  const maxTrades = rules.maxTradesPerDay;
  const tradesRemaining = Math.max(0, maxTrades - tradesTaken);
  const losses = consecutiveLosses(todaysClosed);
  const cooldown = computeCooldown(todaysClosed, rules, now);
  const buffer = drawdownBuffer(account);
  const maxContracts = account.rules.maxContracts;

  const stopReasons: string[] = [];
  const cautionReasons: string[] = [];

  if (account.status === 'failed') stopReasons.push('This account is marked as failed.');
  if (dailyLimit > 0 && riskRemaining <= 0) stopReasons.push("You've reached your daily loss limit.");
  if (maxTrades > 0 && tradesTaken >= maxTrades) stopReasons.push("You've reached your maximum trades for today.");
  if (rules.maxConsecutiveLosses > 0 && losses >= rules.maxConsecutiveLosses) {
    stopReasons.push(`${losses} consecutive losses. Your rules say the session is over.`);
  }
  if (buffer != null && buffer <= 0) stopReasons.push('Drawdown floor reached.');

  if (dailyLimit > 0 && riskUsedPct >= CAUTION_RISK_PCT && riskRemaining > 0) {
    cautionReasons.push(`${Math.round(riskUsedPct * 100)}% of today's risk budget used.`);
  }
  if (cooldown.active) cautionReasons.push('Cooldown active after a loss.');
  if (losses >= 2 && stopReasons.length === 0) cautionReasons.push(`${losses} losses in a row.`);
  if (buffer != null && buffer > 0 && buffer < rules.maxRiskPerTrade * 2) {
    cautionReasons.push('Drawdown buffer is less than two full-risk trades.');
  }
  if (maxTrades > 0 && tradesRemaining === 1 && stopReasons.length === 0) {
    cautionReasons.push('One trade remaining today.');
  }

  let status: GuardStatus = 'SAFE';
  let headline = 'Safe to trade';
  if (stopReasons.length > 0) {
    status = 'STOP';
    headline = 'Stop trading';
  } else if (cautionReasons.length > 0) {
    status = 'CAUTION';
    headline = cooldown.active ? 'Cooldown active' : 'Trade with caution';
  }

  return {
    status,
    headline,
    reasons: status === 'STOP' ? stopReasons : cautionReasons,
    balance: account.balance,
    dailyLimit,
    realizedPnlToday,
    riskUsed,
    riskRemaining,
    riskUsedPct,
    tradesTaken,
    maxTrades,
    tradesRemaining,
    consecutiveLosses: losses,
    cooldown,
    drawdownBuffer: buffer,
    maxContracts,
    openTrades: open.length,
  };
}
