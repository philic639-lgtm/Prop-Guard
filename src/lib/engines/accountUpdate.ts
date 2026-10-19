import type { Account } from '@/types/domain';

import { floorStatus } from './propRuleEngine';

/**
 * "What will change" for an account update (screenshot or manual): the saved account
 * next to the account exactly as it would be saved (`applyImport` output), so every
 * number — including the floor and remaining drawdown under the firm's drawdown model —
 * is the real result, not a re-derivation. Unknown values stay `null` ("Needs
 * verification"); nothing is treated as zero.
 */

export type ChangeKey = 'balance' | 'totalPnl' | 'dailyPnl' | 'floor' | 'remaining' | 'dailyLossLimit' | 'targetProgress' | 'status' | 'asOf';

export interface ChangeRow {
  key: ChangeKey;
  label: string;
  kind: 'money' | 'signed' | 'percent' | 'text';
  before: number | string | null;
  after: number | string | null;
  changed: boolean;
  /** The new value is unknown — shown as "Needs verification", never as 0. */
  needsVerification: boolean;
  /**
   * Where the new value comes from: this update (screenshot / typed), or KEPT from the saved account because the
   * update did not provide it — so an unchanged $25,318 is never mistaken for a screenshot reading.
   */
  origin: 'update' | 'kept';
}

/** Which dashboard figures an update provides, from the confirmed field keys it carries. */
export function providedFigures(keys: Iterable<string>): Set<ChangeKey> {
  const k = new Set(keys);
  const out = new Set<ChangeKey>();
  if (k.has('balance')) out.add('balance').add('totalPnl').add('targetProgress');
  if (k.has('netPnl')) out.add('totalPnl');
  if (k.has('dailyPnl')) out.add('dailyPnl');
  if (k.has('drawdownThreshold') || k.has('drawdownRemaining')) out.add('floor').add('remaining');
  if (k.has('balance') && (k.has('drawdownThreshold') || k.has('drawdownRemaining'))) out.add('remaining');
  if (k.has('dailyLossLimit')) out.add('dailyLossLimit');
  if (k.has('status')) out.add('status');
  if (k.has('statementDate')) out.add('asOf');
  return out;
}

const LABEL: Record<ChangeKey, string> = {
  balance: 'Balance',
  totalPnl: 'Total P&L',
  dailyPnl: 'Today’s P&L',
  floor: 'Drawdown floor',
  remaining: 'Remaining drawdown',
  dailyLossLimit: 'Daily loss limit',
  targetProgress: 'Profit target progress',
  status: 'Status (as shown)',
  asOf: 'Dashboard date',
};

const KIND: Record<ChangeKey, ChangeRow['kind']> = {
  balance: 'money',
  totalPnl: 'signed',
  dailyPnl: 'signed',
  floor: 'money',
  remaining: 'money',
  dailyLossLimit: 'money',
  targetProgress: 'percent',
  status: 'text',
  asOf: 'text',
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** The numbers a trader recognises from the firm's dashboard, for one account state. */
export function accountFigures(a: Account): Record<ChangeKey, number | string | null> {
  const floor = a.kind === 'prop' ? floorStatus(a).floor : null;
  const target = a.rules.profitTarget;
  const st = a.importState?.reported;
  return {
    balance: a.balance,
    // Total P&L is measured from the starting balance (never from the nominal size).
    totalPnl: cents(a.balance - a.startingBalance),
    dailyPnl: st?.dailyPnl ?? null,
    floor,
    remaining: floor != null ? cents(a.balance - floor) : null,
    dailyLossLimit: a.rules.calc?.dailyLossMode === 'none' ? 'None' : a.rules.dailyLossLimit,
    targetProgress: target && target > 0 ? Math.max(0, Math.round(((a.balance - a.cycleStartBalance) / target) * 100)) : null,
    status: st?.statusText ?? null,
    asOf: st?.asOf ?? null,
  };
}

const changedRow = (b: number | string | null, a: number | string | null) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 0.004 : a !== b);

export function compareUpdate(before: Account, after: Account, provided?: Set<ChangeKey>): ChangeRow[] {
  const b = accountFigures(before);
  const a = accountFigures(after);
  const keys: ChangeKey[] = ['balance', 'totalPnl', 'dailyPnl', 'floor', 'remaining', 'dailyLossLimit', 'targetProgress', 'status', 'asOf'];
  return keys
    .filter((k) => !(b[k] == null && a[k] == null && (k === 'dailyPnl' || k === 'status' || k === 'asOf')))
    .map((k) => ({
      key: k,
      label: LABEL[k],
      kind: KIND[k],
      before: b[k],
      after: a[k],
      changed: changedRow(b[k], a[k]),
      needsVerification: a[k] == null,
      // Without a list (manual updates), every row is part of the update; a value that changed always is.
      origin: !provided || provided.has(k) || changedRow(b[k], a[k]) ? 'update' : 'kept',
    }));
}

/** One-line confirmation after a successful save, e.g. "Balance $25,090 → $25,246 · remaining drawdown $976". */
export function updateSummary(rows: ChangeRow[], fmt: (n: number, signed: boolean) => string): string {
  const show = (r: ChangeRow, v: number | string | null) => (v == null ? 'needs verification' : typeof v === 'number' ? (r.kind === 'percent' ? `${v}%` : fmt(v, r.kind === 'signed')) : v);
  const bal = rows.find((r) => r.key === 'balance');
  const rem = rows.find((r) => r.key === 'remaining');
  const parts: string[] = [];
  if (bal) parts.push(bal.changed ? `Balance ${show(bal, bal.before)} → ${show(bal, bal.after)}` : `Balance ${show(bal, bal.after)} (unchanged)`);
  if (rem) parts.push(`remaining drawdown ${show(rem, rem.after)}`);
  return parts.join(' · ');
}
