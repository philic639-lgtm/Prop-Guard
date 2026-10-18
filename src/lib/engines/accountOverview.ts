import type { Account, Trade, TradingRules } from '@/types/domain';

import { accountFreshness } from './accountDetails';
import { tradesAwaitingBalance } from './accountSync';
import { computeDailyGuard } from './dailyGuardEngine';
import { floorStatus, maxDrawdownAmount } from './propRuleEngine';

/**
 * My Accounts — one compact, comparable summary per account. Every number comes from the
 * SAME engines as the account's own dashboard (Daily Guard, floor policy, freshness), so
 * the overview can never disagree with the dashboard. Nothing is guessed: an unknown
 * floor is "Needs update", never a number, and no account is ever called breached — a
 * balance at or below the saved floor is "Check with your firm" (the firm decides).
 */

export type AccountFilter = 'all' | 'attention' | 'evaluation' | 'funded' | 'recent';
export const FILTER_LABEL: Record<AccountFilter, string> = { all: 'All Accounts', attention: 'Needs Attention', evaluation: 'Evaluations', funded: 'Funded', recent: 'Recently Updated' };

export type AttentionLevel = 'critical' | 'warning' | 'info';
export interface AttentionReason {
  level: AttentionLevel;
  text: string;
}

export interface AccountCard {
  id: string;
  name: string;
  firm: string;
  initials: string;
  size: number;
  program: string | null;
  stage: 'evaluation' | 'funded' | 'live' | null;
  status: Account['status'];
  primary: boolean;
  active: boolean;
  balance: number;
  /** Remaining drawdown from a verified/confirmed floor — null = "Needs update". */
  remaining: number | null;
  /** Remaining as a share of the max drawdown allowance (0–1), when both are known. */
  remainingShare: number | null;
  /** Profit target progress 0–1, when a target is set. */
  targetProgress: number | null;
  snapshotBased: boolean;
  lastUpdate: { at: string; label: string; stale: boolean };
  attention: AttentionReason[];
}

/** Low remaining drawdown: at most this share of the allowance, or this many dollars without an allowance. */
export const CRITICAL_SHARE = 0.25;
export const CRITICAL_DOLLARS = 250;
const RECENT_HOURS = 24;

const initialsOf = (firm: string, name: string) =>
  (firm || name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '·';

/** Evaluation / funded from the verified firm link, else from the account name ("Eval", "Funded", "PA"). */
export function stageOf(a: Account): AccountCard['stage'] {
  if (a.firmLink?.stage) return a.firmLink.stage;
  const n = `${a.name} ${a.firmLink?.programName ?? ''}`.toLowerCase();
  if (/\beval|evaluation|combine|challenge/.test(n)) return 'evaluation';
  if (/\bfunded|\bpa\b|performance account|express|live/.test(n)) return 'funded';
  return null;
}

export function accountCard(a: Account, ctx: { trades: Trade[]; rules: TradingRules; now: Date; primaryId: string | null; activeId: string | null }): AccountCard {
  const guard = computeDailyGuard({ account: a, rules: ctx.rules, trades: ctx.trades, now: ctx.now });
  const fresh = accountFreshness(a, ctx.now);
  const floor = a.kind === 'prop' ? floorStatus(a).floor : null;
  const remaining = a.kind === 'prop' ? guard.drawdownBuffer : null;
  const allowance = maxDrawdownAmount(a);
  const remainingShare = remaining != null && allowance ? Math.max(0, Math.min(1, remaining / allowance)) : null;
  const target = a.rules.profitTarget;
  const attention: AttentionReason[] = [];
  if (a.status === 'active' && a.kind === 'prop') {
    if (remaining == null) attention.push({ level: 'warning', text: 'Drawdown floor unknown — needs update' });
    else if (floor != null && a.balance <= floor) attention.push({ level: 'critical', text: 'Balance at or below the saved drawdown floor — check with your firm' });
    else if ((remainingShare != null && remainingShare <= CRITICAL_SHARE) || (remainingShare == null && remaining <= CRITICAL_DOLLARS))
      attention.push({ level: 'critical', text: remainingShare != null ? `Critically low drawdown left (${Math.round(remainingShare * 100)}% of the allowance)` : `Critically low drawdown left (under $${CRITICAL_DOLLARS})` });
    // Daily loss is per account: a stop or a nearly used firm DLL is never hidden behind a healthy drawdown.
    if (guard.firmDailyLimit != null && guard.firmDailyRoom != null && guard.firmDailyRoom <= 0)
      attention.push({ level: 'critical', text: "Firm daily loss limit reached today" });
    else if (guard.firmDailyLimit != null && guard.firmDailyRoom != null && guard.firmDailyRoom <= guard.firmDailyLimit * CRITICAL_SHARE)
      attention.push({ level: 'warning', text: `Firm daily loss limit nearly used — $${Math.round(guard.firmDailyRoom)} left today` });
    else if (guard.status === 'STOP') attention.push({ level: 'warning', text: `Daily Guard: stop — ${guard.reasons[0] ?? 'a limit is reached'}` });
    if (guard.drawdownMinimum) attention.push({ level: 'info', text: 'Intraday trailing floor — re-confirm the threshold' });
    if (fresh.stale) attention.push({ level: 'info', text: 'Values are from an earlier trading day — update' });
    const awaiting = tradesAwaitingBalance(a, ctx.trades);
    if (awaiting.length) attention.push({ level: 'info', text: `${awaiting.length} trade screenshot${awaiting.length > 1 ? 's' : ''} not in the balance yet` });
  }
  return {
    id: a.id,
    name: a.name,
    firm: a.firm,
    initials: initialsOf(a.firm, a.name),
    size: a.size,
    program: a.firmLink?.programName ?? null,
    stage: stageOf(a),
    status: a.status,
    primary: ctx.primaryId === a.id,
    active: ctx.activeId === a.id,
    balance: a.balance,
    remaining,
    remainingShare,
    targetProgress: target && target > 0 ? Math.max(0, Math.min(1, (a.balance - a.cycleStartBalance) / target)) : null,
    snapshotBased: !!a.importState?.reported,
    lastUpdate: { at: fresh.at, label: fresh.label, stale: fresh.stale },
    attention,
  };
}

const LEVEL_RANK: Record<AttentionLevel, number> = { critical: 0, warning: 1, info: 2 };

export function needsAttention(c: AccountCard): boolean {
  return c.attention.some((r) => r.level !== 'info');
}

/** Archived accounts are hidden unless asked for; primary first, then the most urgent, then by name. */
export function overview(cards: AccountCard[], filter: AccountFilter, opts: { showArchived?: boolean; now: Date }): AccountCard[] {
  const recentCutoff = opts.now.getTime() - RECENT_HOURS * 3_600_000;
  return cards
    .filter((c) => (opts.showArchived ? true : c.status !== 'archived'))
    .filter((c) =>
      filter === 'attention'
        ? needsAttention(c)
        : filter === 'evaluation'
          ? c.stage === 'evaluation'
          : filter === 'funded'
            ? c.stage === 'funded' || c.stage === 'live'
            : filter === 'recent'
              ? Date.parse(c.lastUpdate.at) >= recentCutoff
              : true,
    )
    .sort((x, y) => {
      if (x.primary !== y.primary) return x.primary ? -1 : 1;
      const ux = Math.min(...x.attention.map((r) => LEVEL_RANK[r.level]), 3);
      const uy = Math.min(...y.attention.map((r) => LEVEL_RANK[r.level]), 3);
      if (filter === 'recent') return Date.parse(y.lastUpdate.at) - Date.parse(x.lastUpdate.at);
      return ux - uy || x.name.localeCompare(y.name);
    });
}

export function filterCounts(cards: AccountCard[], now: Date): Record<AccountFilter, number> {
  const out = {} as Record<AccountFilter, number>;
  for (const f of Object.keys(FILTER_LABEL) as AccountFilter[]) out[f] = overview(cards, f, { now }).length;
  return out;
}
