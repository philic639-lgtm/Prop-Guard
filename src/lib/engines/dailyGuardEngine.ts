import type { Account, GuardStatus, Trade, TradingRules } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import { dailyLossLimitFor, drawdownBuffer } from './propRuleEngine';

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
  /** Which limit sets `dailyLimit`: the trader's own daily stop or the firm's daily loss limit (ties count as the firm's). */
  dailyLimitSource: 'personal' | 'firm' | 'none';
  /** What bounds `riskRemaining`: the daily budget above, or the room left above the drawdown floor. */
  riskRemainingSource: 'personal' | 'firm' | 'drawdown' | 'none';
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
  /** The trader's own daily stop (personal plan) and what is left of it — not a firm rule. */
  personalDailyStop: number | null;
  personalRoom: number | null;
  /** The firm's daily loss limit for this account and what is left of it (from journaled trades). */
  firmDailyLimit: number | null;
  firmDailyRoom: number | null;
  /** Where today's P&L comes from: journaled trades, or unknown (a screenshot-only account with nothing journaled today). */
  dailyPnlSource: 'journal' | 'unknown';
  /** Set when the balance / floor come from a confirmed screenshot (not a live connection). */
  snapshot: { at: string; ageHours: number; stale: boolean; missing: string[] } | null;
  /** Prop account whose drawdown floor is not known — no buffer is shown or used. */
  drawdownUnknown: boolean;
}

/** Plain-language name of the limit behind a Daily Guard number, so personal and firm limits are never blurred. */
export const LIMIT_SOURCE_LABEL: Record<DailyGuard['riskRemainingSource'], string> = {
  personal: 'your daily stop',
  firm: "firm's daily loss limit",
  drawdown: 'room above drawdown floor',
  none: 'no daily limit set',
};

/** Short form for small tiles. */
export const LIMIT_SOURCE_SHORT: Record<DailyGuard['riskRemainingSource'], string> = {
  personal: 'your stop',
  firm: 'firm DLL',
  drawdown: 'drawdown',
  none: 'not set',
};

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

  // The account's daily limit as its program defines it (fixed, scaling, or verified "none").
  const accountDaily = dailyLossLimitFor(account)?.limit ?? null;
  const limits = [rules.dailyStop, accountDaily].filter(
    (v): v is number => typeof v === 'number' && v > 0,
  );
  const dailyLimit = limits.length > 0 ? Math.min(...limits) : 0;
  const dailyLimitSource: DailyGuard['dailyLimitSource'] =
    dailyLimit <= 0 ? 'none' : accountDaily != null && accountDaily > 0 && accountDaily <= dailyLimit ? 'firm' : 'personal';

  const realizedPnlToday = todaysClosed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const openRisk = open.reduce((s, t) => s + t.riskDollars, 0);
  const riskUsed = Math.max(0, -realizedPnlToday) + openRisk;
  const buffer = drawdownBuffer(account);
  // What can still be lost today: the daily budget AND the room above the drawdown floor
  // (open risk counts against both). Never more than either.
  const dailyRoom = Math.max(0, dailyLimit - riskUsed);
  const drawdownRoom = buffer != null ? Math.max(0, buffer - openRisk) : null;
  const riskRemaining = dailyLimit > 0 ? (drawdownRoom != null ? Math.min(dailyRoom, drawdownRoom) : dailyRoom) : (drawdownRoom ?? 0);
  const riskRemainingSource: DailyGuard['riskRemainingSource'] =
    dailyLimit > 0 ? (drawdownRoom != null && drawdownRoom < dailyRoom ? 'drawdown' : dailyLimitSource) : drawdownRoom != null ? 'drawdown' : 'none';
  const riskUsedPct = dailyLimit > 0 ? Math.min(1, riskUsed / dailyLimit) : 0;

  const tradesTaken = todays.length;
  const maxTrades = rules.maxTradesPerDay;
  const tradesRemaining = Math.max(0, maxTrades - tradesTaken);
  const losses = consecutiveLosses(todaysClosed);
  const cooldown = computeCooldown(todaysClosed, rules, now);
  const maxContracts = account.rules.maxContracts;

  const stopReasons: string[] = [];
  const cautionReasons: string[] = [];

  if (account.status === 'failed') stopReasons.push('This account is marked as failed.');
  if (dailyLimit > 0 && dailyRoom <= 0) stopReasons.push(dailyLimitSource === 'firm' ? "You've reached the firm's daily loss limit." : "You've reached your personal daily stop.");
  if (maxTrades > 0 && tradesTaken >= maxTrades) stopReasons.push("You've reached your maximum trades for today.");
  if (rules.maxConsecutiveLosses > 0 && losses >= rules.maxConsecutiveLosses) {
    stopReasons.push(`${losses} consecutive losses. Your rules say the session is over.`);
  }
  if (buffer != null && buffer <= 0) stopReasons.push('Drawdown floor reached.');

  if (dailyLimit > 0 && riskUsedPct >= CAUTION_RISK_PCT && dailyRoom > 0) {
    cautionReasons.push(`${Math.round(riskUsedPct * 100)}% of today's risk budget used.`);
  }
  if (cooldown.active) cautionReasons.push('Cooldown active after a loss.');
  if (losses >= 2 && stopReasons.length === 0) cautionReasons.push(`${losses} losses in a row.`);
  // Unknown drawdown floor (no verified allowance, no confirmed threshold): never treated as room to lose.
  const drawdownUnknown = account.kind === 'prop' && buffer == null;
  if (drawdownUnknown) cautionReasons.push('Drawdown floor unknown — additional account information required. Add the liquidation threshold (MLL / NLL) before relying on risk room.');
  if (buffer != null && buffer > 0 && buffer < rules.maxRiskPerTrade * 2) {
    cautionReasons.push('Drawdown buffer is less than two full-risk trades.');
  }
  if (maxTrades > 0 && tradesRemaining === 1 && stopReasons.length === 0) {
    cautionReasons.push('One trade remaining today.');
  }

  // Screenshot-only accounts are a snapshot, not live data: they are never "safe to trade" on the strength
  // of a personal budget alone, and the age of the snapshot is always visible.
  const reported = account.importState?.reported ?? null;
  const snapshot = reported
    ? (() => {
        // A screenshot is as old as the dashboard date it shows (when read), not the moment it was imported.
        const shot = reported.asOf && reported.asOf < dayKey(reported.at) ? `${reported.asOf}T12:00:00` : reported.at;
        // …and a later correction by the trader (Edit Account Details) is newer data.
        const edited = account.importState?.editedAt;
        const asOf = edited && Date.parse(edited) > Date.parse(shot) ? edited : shot;
        const ageHours = Math.max(0, (now.getTime() - Date.parse(asOf)) / 3_600_000);
        const stale = dayKey(asOf) !== today;
        return { at: reported.at, ageHours: Math.round(ageHours * 10) / 10, stale, missing: reported.missing ?? [] };
      })()
    : null;
  if (snapshot) {
    cautionReasons.unshift(
      snapshot.stale
        ? 'Snapshot-based — from an earlier day. Update the screenshot: the balance and floor may have moved.'
        : 'Snapshot-based — not live verified. Trades since the screenshot count only if journaled.',
    );
  }

  let status: GuardStatus = 'SAFE';
  let headline = 'Safe to trade';
  if (stopReasons.length > 0) {
    status = 'STOP';
    headline = 'Stop trading';
  } else if (cautionReasons.length > 0) {
    status = 'CAUTION';
    headline = cooldown.active ? 'Cooldown active' : snapshot ? 'Snapshot-based — not live verified' : 'Trade with caution';
  }
  const personalDailyStop = rules.dailyStop > 0 ? rules.dailyStop : null;

  return {
    status,
    headline,
    reasons: status === 'STOP' ? stopReasons : cautionReasons,
    balance: account.balance,
    dailyLimit,
    dailyLimitSource,
    riskRemainingSource,
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
    drawdownUnknown,
    personalDailyStop,
    personalRoom: personalDailyStop != null ? Math.max(0, personalDailyStop - riskUsed) : null,
    firmDailyLimit: accountDaily,
    firmDailyRoom: accountDaily != null ? Math.max(0, accountDaily - riskUsed) : null,
    dailyPnlSource: snapshot && todaysClosed.length === 0 ? 'unknown' : 'journal',
    snapshot,
    maxContracts,
    openTrades: open.length,
  };
}
