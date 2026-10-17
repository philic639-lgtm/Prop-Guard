import type { CopierEvent, CopierEventKind, CopierState, CopyGroup, FollowerLink } from '@/types/copyTrade';
import type { Account } from '@/types/domain';

import type { DailyGuard } from './dailyGuardEngine';
import { cleanNumber, findInstrument, pointsBetween } from './instrumentEngine';

/**
 * Account copier (pure). Links a master account to follower accounts with
 * multipliers and per-account limits, reports connection status, previews
 * what each follower WOULD take for a master trade, and moves the group
 * between setup / paused / stopped.
 *
 * Nothing here executes trades. Live copying ("running") requires a
 * connected, supported broker for the master and every enabled follower;
 * with none available, `canStartLive` refuses and says why.
 */

export const MAX_MULTIPLIER = 10;
export const ACTIVITY_CAP = 100;

export const STATE_LABEL: Record<CopierState, string> = { setup: 'Setup only', running: 'Running', paused: 'Paused', stopped: 'Stopped' };

export interface CopierIssue {
  field: 'master' | 'follower' | 'multiplier' | 'limits';
  accountId?: string;
  message: string;
}

const fin = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function newCopyGroup(id: string, now: string): CopyGroup {
  return { id, name: 'My trade copier', masterAccountId: null, followers: [], state: 'setup', activity: [{ id: `${id}-0`, at: now, kind: 'created', detail: 'Copier created (setup only).' }], createdAt: now, updatedAt: now };
}

export function defaultFollower(accountId: string): FollowerLink {
  return { accountId, multiplier: 1, maxContracts: null, dailyLossLimit: null, enabled: true };
}

/** Problems that make the configuration invalid (shown inline; a preview is refused while any exist). */
export function validateCopyGroup(g: CopyGroup, accounts: Account[]): CopierIssue[] {
  const issues: CopierIssue[] = [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (!g.masterAccountId) issues.push({ field: 'master', message: 'Choose the master account (the one you trade).' });
  else if (!byId.has(g.masterAccountId)) issues.push({ field: 'master', message: 'The master account no longer exists — choose another.' });
  if (!g.followers.length) issues.push({ field: 'follower', message: 'Link at least one follower account.' });
  const seen = new Set<string>();
  for (const f of g.followers) {
    const name = byId.get(f.accountId)?.name ?? 'A follower';
    if (!byId.has(f.accountId)) issues.push({ field: 'follower', accountId: f.accountId, message: 'A linked follower account no longer exists — remove it.' });
    if (f.accountId === g.masterAccountId) issues.push({ field: 'follower', accountId: f.accountId, message: `${name} is the master — it cannot also follow.` });
    if (seen.has(f.accountId)) issues.push({ field: 'follower', accountId: f.accountId, message: `${name} is linked twice.` });
    seen.add(f.accountId);
    if (!fin(f.multiplier) || f.multiplier <= 0 || f.multiplier > MAX_MULTIPLIER) issues.push({ field: 'multiplier', accountId: f.accountId, message: `${name}: multiplier must be above 0 and at most ${MAX_MULTIPLIER}×.` });
    if ((f.maxContracts != null && (!fin(f.maxContracts) || f.maxContracts < 1)) || (f.dailyLossLimit != null && (!fin(f.dailyLossLimit) || f.dailyLossLimit <= 0)))
      issues.push({ field: 'limits', accountId: f.accountId, message: `${name}: limits must be positive numbers (or empty).` });
  }
  return issues;
}

export interface ConnectionStatus {
  state: 'connected' | 'not_connected';
  label: string;
  detail: string;
}

/**
 * Connection / sync status of an account for copying. `connectedBrokers` are
 * the broker integrations actually registered and authenticated (none ship yet).
 */
export function connectionStatus(account: Account, connectedBrokers: readonly string[]): ConnectionStatus {
  if (connectedBrokers.length) return { state: 'connected', label: 'Broker connected', detail: `Via ${connectedBrokers.join(', ')}.` };
  const snapshot = account.importState?.reported?.at;
  return {
    state: 'not_connected',
    label: 'Not connected',
    detail: snapshot ? `No broker link — balance from a screenshot (${snapshot.slice(0, 10)}).` : 'No broker link — balance tracked in Prop Guard.',
  };
}

/**
 * Live copying would need a connected broker for every account AND an order-
 * routing integration. Neither exists in V1, so this always refuses, with why.
 */
export function canStartLive(g: CopyGroup, accounts: Account[], connectedBrokers: readonly string[]): { ok: boolean; reason: string } {
  if (validateCopyGroup(g, accounts).length) return { ok: false, reason: 'Finish the setup first.' };
  if (!connectedBrokers.length) return { ok: false, reason: 'Live copying needs a connected, supported broker (Tradovate, NinjaTrader, ProjectX, Rithmic — coming soon). Until then this is setup and preview only; Prop Guard never places trades.' };
  // A broker can be registered for journaling without order routing: no execution path exists yet.
  return { ok: false, reason: `Order copying is not implemented for ${connectedBrokers.join(', ')} yet — setup and preview only.` };
}

/** Pause / resume / stop. `start` (live) goes through canStartLive and is refused without a broker. */
export function transition(g: CopyGroup, action: 'pause' | 'resume' | 'stop', at: string, eventId: string): CopyGroup {
  const next: CopierState = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'setup';
  const kind: CopierEventKind = action === 'pause' ? 'paused' : action === 'stop' ? 'stopped' : 'resumed';
  const detail = action === 'pause' ? 'Copier paused.' : action === 'stop' ? 'Copier stopped — links kept, nothing will be copied.' : 'Copier resumed (setup only — no broker connected).';
  return withEvent({ ...g, state: next }, { id: eventId, at, kind, detail });
}

export function withEvent(g: CopyGroup, e: CopierEvent): CopyGroup {
  return { ...g, activity: [e, ...g.activity].slice(0, ACTIVITY_CAP), updatedAt: e.at };
}

// ───────────────────────────── Preview ─────────────────────────────

export interface MasterOrder {
  instrument: string;
  direction: 'long' | 'short';
  contracts: number;
  entry: number | null;
  stop: number | null;
}

export type PreviewStatus = 'ok' | 'reduced' | 'blocked' | 'review';

export interface FollowerPreview {
  accountId: string;
  accountName: string;
  /** master × multiplier, rounded down. */
  desired: number;
  contracts: number;
  riskDollars: number | null;
  status: PreviewStatus;
  reason: string;
}

export interface CopyPreview {
  ok: boolean;
  /** Why the preview cannot run (invalid setup / inputs). */
  error: string | null;
  masterRisk: number | null;
  rows: FollowerPreview[];
}

/**
 * What each enabled follower WOULD take for a master trade — sized by its
 * multiplier and capped by its own contract caps, its per-account daily loss
 * limit, and its Daily Guard (daily room, drawdown, STOP). A preview only.
 */
export function previewCopy(g: CopyGroup, order: MasterOrder, accounts: Account[], guards: Map<string, DailyGuard>): CopyPreview {
  const issues = validateCopyGroup(g, accounts);
  if (issues.length) return { ok: false, error: issues[0].message, masterRisk: null, rows: [] };
  const spec = findInstrument(order.instrument);
  if (!spec) return { ok: false, error: `${order.instrument} is not in your contract list.`, masterRisk: null, rows: [] };
  if (!fin(order.contracts) || order.contracts < 1 || Math.floor(order.contracts) !== order.contracts) return { ok: false, error: 'Enter the master’s contracts as a whole number.', masterRisk: null, rows: [] };
  const hasStop = fin(order.entry) && fin(order.stop) && pointsBetween(order.entry, order.stop) > 0;
  if (hasStop && ((order.direction === 'long' && order.stop! >= order.entry!) || (order.direction === 'short' && order.stop! <= order.entry!)))
    return { ok: false, error: 'The stop is on the wrong side of the entry.', masterRisk: null, rows: [] };
  const perContract = hasStop ? cleanNumber(pointsBetween(order.entry!, order.stop!) * spec.pointValue, 2) : null;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const rows: FollowerPreview[] = g.followers
    .filter((f) => f.enabled)
    .map((f) => {
      const acc = byId.get(f.accountId)!;
      const guard = guards.get(f.accountId) ?? null;
      const desired = Math.floor(cleanNumber(order.contracts * f.multiplier, 6));
      const row = (status: PreviewStatus, contracts: number, reason: string): FollowerPreview => ({
        accountId: f.accountId,
        accountName: acc.name,
        desired,
        contracts,
        riskDollars: perContract != null ? cleanNumber(perContract * contracts, 2) : null,
        status,
        reason,
      });
      if (guard?.status === 'STOP') return row('blocked', 0, `Account stopped: ${guard.reasons[0] ?? 'daily limits reached'}`);
      if (desired < 1) return row('blocked', 0, `${order.contracts} × ${f.multiplier} rounds down to 0 contracts.`);
      const caps = [f.maxContracts, acc.rules.maxContracts].filter((x): x is number => fin(x) && x > 0);
      const cap = caps.length ? Math.min(...caps) : null;
      let n = cap != null ? Math.min(desired, cap) : desired;
      let why = cap != null && n < desired ? `contract cap ${cap}` : '';
      if (perContract == null) return row('review', n, `${why ? `Capped by ${why}. ` : ''}Add the master’s entry and stop to check dollar risk.`);
      if (guard?.drawdownUnknown) return row('review', n, 'Drawdown floor unknown for this account — add its liquidation threshold before copying.');
      const limits = [f.dailyLossLimit, guard && (guard.dailyLimit > 0 || guard.drawdownBuffer != null) ? Math.max(0, guard.riskRemaining) : null].filter((x): x is number => fin(x));
      if (limits.length) {
        const room = Math.min(...limits);
        const byRisk = Math.floor(cleanNumber(room / perContract, 6));
        if (byRisk < n) {
          n = byRisk;
          why = `${usd(room)} risk room`;
        }
        if (n < 1) return row('blocked', 0, `One ${spec.symbol} risks ${usd(perContract)} — more than this account’s ${usd(room)} risk room.`);
      } else if (!guard) {
        return row('review', n, 'No limits for this account — set a per-account daily loss limit.');
      }
      return n < desired ? row('reduced', n, `Reduced from ${desired} to ${n} by ${why}.`) : row('ok', n, `${n} × ${usd(perContract)} = ${usd(perContract * n)} risk.`);
    });
  return { ok: true, error: null, masterRisk: perContract != null ? cleanNumber(perContract * order.contracts, 2) : null, rows };
}
