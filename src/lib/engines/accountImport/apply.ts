import type { Account, AccountDetailKey, AccountImportRecord, AccountImportState } from '@/types/domain';

import { snapshotValues, stampImportOrigins } from '../accountDetails';
import { confirmedThreshold, drawdownFloor, maxDrawdownAmount, observedFloor, ruleFloor } from '../propRuleEngine';
import { DRAWDOWN_TYPES, type ExtractedField, type FieldKey, type FieldSource } from './types';

/**
 * Apply a CONFIRMED screenshot import to an account.
 *
 * Updates the balance and the drawdown tracking (high-water mark) so the
 * account's own program rules — `propRuleEngine.drawdownFloor` — reproduce
 * the threshold the firm shows. Rule values (max drawdown, daily loss limit,
 * target) are only written when the trader explicitly chose to, and never
 * over rules loaded from a verified program. Every update is kept in the
 * account's import history; screenshots themselves are not stored.
 */

export interface ConfirmedImport {
  /** Final values after the trader's review (null = not detected / cleared). */
  values: Partial<Record<FieldKey, number | string | null>>;
  /** Per-field provenance for the history. */
  sources: Partial<Record<FieldKey, { source: FieldSource; confidence: number | null; edited: boolean }>>;
  /** Rule values the trader chose to save from the screenshot (unverified accounts only). */
  ruleUpdates: Partial<Record<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget', number>>;
  fingerprint: string | null;
  /** Kept only if the trader chose not to redact it. */
  maskedId: string | null;
  engine: AccountImportRecord['engine'];
  pages: number;
  confirmedAt: string;
  /** The trader confirmed the account was reset: the floor starts over from this screenshot (it may be lower). */
  reset?: boolean;
  /** Values the trader corrected by hand and chose to KEEP over this screenshot (see `manualConflicts`). */
  keepManual?: AccountDetailKey[];
}

/** Values a dashboard snapshot should show; the ones it did not are listed as unknown on the account. */
const SNAPSHOT_FIELDS: FieldKey[] = ['balance', 'drawdownThreshold', 'maxDrawdown', 'dailyLossLimit', 'profitTarget', 'netPnl', 'tradingDays'];

const HISTORY_CAP = 30;
const TOL = 1;
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rule fields a screenshot may never change on this account (loaded from a verified program and not overridden). */
export function lockedRuleFields(account: Account | null): Set<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget'> {
  const out = new Set<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget'>();
  const link = account?.firmLink;
  if (!link || link.status !== 'verified') return out;
  // Only rules the verified program actually states. An optional setting it leaves to the account
  // (e.g. LucidFlex's DLL amount) is the trader's / the screenshot's to set.
  for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) if (!link.overrides.includes(k) && String(link.imported?.[k] ?? '').trim() !== '') out.add(k);
  // A verified "no daily loss limit" is also a verified value.
  if (link.calc?.dailyLossMode === 'none') out.add('dailyLossLimit');
  return out;
}

/** Build the confirmed import from reviewed fields. */
export function confirmImport(input: {
  fields: Partial<Record<FieldKey, ExtractedField | null>>;
  edited: Set<FieldKey>;
  ruleUpdates?: ConfirmedImport['ruleUpdates'];
  reset?: boolean;
  fingerprint: string | null;
  maskedId: string | null;
  engine: ConfirmedImport['engine'];
  pages: number;
  now: Date;
  keepManual?: AccountDetailKey[];
}): ConfirmedImport {
  const values: ConfirmedImport['values'] = {};
  const sources: ConfirmedImport['sources'] = {};
  for (const [k, f] of Object.entries(input.fields) as [FieldKey, ExtractedField | null][]) {
    if (!f) continue;
    values[k] = f.value;
    const edited = input.edited.has(k);
    sources[k] = { source: edited ? 'user' : f.source, confidence: edited ? null : f.confidence, edited };
  }
  return { values, sources, ruleUpdates: input.ruleUpdates ?? {}, fingerprint: input.fingerprint, maskedId: input.maskedId, engine: input.engine, pages: input.pages, confirmedAt: input.now.toISOString(), ...(input.reset ? { reset: true } : {}), ...(input.keepManual?.length ? { keepManual: input.keepManual } : {}) };
}

export interface ApplyResult {
  account: Account;
  record: AccountImportRecord;
  /** Firm-reported threshold vs Prop Guard's calculation from the program rules. */
  floorCheck: { reported: number; calculated: number | null; matches: boolean } | null;
}

export function applyImport(account: Account, c: ConfirmedImport, id: string): ApplyResult {
  const notes: string[] = [];
  const before = { balance: account.balance, highWaterMark: account.highWaterMark };
  const next: Account = { ...account, rules: { ...account.rules } };
  const keep = new Set(c.keepManual ?? []);
  const applied: AccountDetailKey[] = [];
  for (const k of keep) notes.push(`${k}: your manual correction was kept (the screenshot value was not applied).`);

  // Rule values: only ones the trader chose, never verified ones, never a kept manual correction.
  const locked = lockedRuleFields(account);
  for (const [k, v] of Object.entries(c.ruleUpdates) as ['maxDrawdown' | 'dailyLossLimit' | 'profitTarget', number][]) {
    if (locked.has(k)) {
      notes.push(`${k} kept from the verified program rules.`);
      continue;
    }
    if (keep.has(k)) continue;
    if (v > 0) {
      next.rules[k] = v;
      applied.push(k);
      notes.push(`${k} set from the screenshot (unverified).`);
    }
  }

  // Drawdown type / starting balance read on the screenshot (never over a verified rule or a kept correction).
  const ddType = c.values.drawdownType;
  const verifiedType = account.firmLink?.status === 'verified' && !account.firmLink.overrides.includes('drawdownType') && String(account.firmLink.imported?.drawdownType ?? '').trim() !== '';
  if ((DRAWDOWN_TYPES as readonly string[]).includes(String(ddType)) && !verifiedType && !keep.has('drawdownType')) {
    next.rules.drawdownType = ddType as (typeof DRAWDOWN_TYPES)[number];
    applied.push('drawdownType');
  }
  // Starting balance: only when the account is created from this import ("opening balance" on some
  // dashboards is the start of the DAY) — an existing account's start is changed in Edit Account Details.
  const start = n(c.values.startingBalance);
  const fresh = !account.importState;
  if (fresh && start != null && start > 0 && !keep.has('startingBalance') && c.sources.startingBalance?.source !== 'derived') {
    if (Math.abs(account.cycleStartBalance - account.startingBalance) < 0.005) next.cycleStartBalance = start;
    next.startingBalance = start;
    applied.push('startingBalance');
  }

  const balance = keep.has('balance') ? null : n(c.values.balance);
  if (balance != null) {
    next.balance = balance;
    applied.push('balance');
  }
  const bal = next.balance;

  // Drawdown tracking. The floor the firm shows is the account's floor — never recomputed from the
  // starting balance. A trailing floor never moves down unless the trader confirmed a reset.
  const maxDd = maxDrawdownAmount(next);
  // A kept manual threshold is not replaced by the screenshot's.
  const keepThreshold = keep.has('drawdownThreshold');
  const reportedThreshold = keepThreshold ? null : n(c.values.drawdownThreshold);
  const reportedRemaining = keepThreshold ? null : n(c.values.drawdownRemaining);
  const used = n(c.values.currentDrawdown);
  const shownFloor = reportedThreshold ?? (reportedRemaining != null ? bal - reportedRemaining : null);
  const trailing = next.rules.drawdownType !== 'static';
  const prevFloor = c.reset ? null : drawdownFloor(account);
  let firmFloor = shownFloor;
  if (firmFloor != null && trailing && prevFloor != null && firmFloor < prevFloor - TOL) {
    notes.push(`The screenshot's minimum balance ($${firmFloor.toLocaleString('en-US')}) is below the account's floor ($${prevFloor.toLocaleString('en-US')}); a trailing floor does not move down, so the higher floor is kept. Confirm a reset to start over.`);
    firmFloor = prevFloor;
  }
  if (c.reset) notes.push('Account reset confirmed: the drawdown floor starts over from this screenshot.');
  const prevHwm = c.reset ? next.startingBalance : account.highWaterMark;
  let hwm = Math.max(prevHwm, bal);
  if (trailing && maxDd && !keepThreshold) {
    const lockOffset = next.rules.calc?.trailingLockOffset ?? (next.rules.trailingLocksAtStart ? 0 : null);
    const lock = lockOffset != null ? next.startingBalance + lockOffset : null;
    if (firmFloor != null) {
      const fromFloor = firmFloor + maxDd;
      // At the lock the floor no longer tells us the peak; keep what we know.
      hwm = lock != null && firmFloor >= lock - TOL ? Math.max(prevHwm, bal, fromFloor) : Math.max(next.startingBalance, fromFloor, bal);
    } else if (used != null) {
      hwm = Math.max(next.startingBalance, bal + used);
    }
  }
  next.highWaterMark = Math.round(hwm * 100) / 100;

  let floorCheck: ApplyResult['floorCheck'] = null;
  if (firmFloor != null) {
    // Compare with the RULES (not with the observed floor itself).
    const calculated = ruleFloor(next);
    const matches = calculated != null && Math.abs(calculated - firmFloor) <= TOL;
    floorCheck = { reported: firmFloor, calculated, matches };
    if (calculated == null) notes.push('No max drawdown on this account — the firm’s threshold is shown as reported.');
    else if (!matches) notes.push(`The firm shows a threshold of $${firmFloor.toLocaleString('en-US')}; the account’s rules calculate $${calculated.toLocaleString('en-US')}. Check the drawdown rules or the screenshot.`);
  }

  // No threshold on this screenshot: the account's last confirmed floor stays (never silently dropped
  // to a lower, rule-only floor); the rule trail can still raise it via drawdownFloor.
  const keptFloor = firmFloor ?? (c.reset ? null : observedFloor(account));
  if (firmFloor == null && keptFloor != null) notes.push(`No liquidation threshold on this screenshot — the account’s last confirmed floor ($${keptFloor.toLocaleString('en-US')}) is kept.`);

  const record: AccountImportRecord = {
    id,
    at: c.confirmedAt,
    engine: c.engine,
    pages: c.pages,
    fields: (Object.entries(c.values) as [FieldKey, number | string | null][])
      .filter(([, v]) => v != null)
      .map(([key, value]) => ({ key, value: value!, confidence: c.sources[key]?.confidence ?? null, source: c.sources[key]?.source ?? 'user', edited: c.sources[key]?.edited ?? false })),
    before,
    after: { balance: next.balance, highWaterMark: next.highWaterMark },
    notes,
    previous: snapshotValues(account),
  };

  const prev: AccountImportState = account.importState ?? { fingerprint: null, maskedId: null, reported: null, history: [] };
  const prevThreshold = confirmedThreshold(account);
  const statementDate = typeof c.values.statementDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.values.statementDate) ? c.values.statementDate : null;
  next.importState = {
    ...prev,
    fingerprint: prev.fingerprint ?? c.fingerprint,
    maskedId: c.maskedId ?? prev.maskedId,
    // The account's confirmed threshold: the screenshot's (or the higher floor the account already had),
    // unless the trader kept a manual one.
    threshold: keepThreshold
      ? (prev.threshold ?? prevThreshold)
      : keptFloor != null
        ? { value: keptFloor, source: firmFloor != null && shownFloor != null && Math.abs(firmFloor - shownFloor) <= TOL ? 'screenshot' : (prevThreshold?.source ?? 'screenshot'), at: c.confirmedAt }
        : (prev.threshold ?? null),
    reported: {
      at: c.confirmedAt,
      asOf: statementDate,
      balance,
      drawdownThreshold: keepThreshold ? (prevThreshold?.value ?? null) : keptFloor,
      // Remaining cushion = balance − current floor (the dashboard's own number when it agrees).
      drawdownRemaining: keepThreshold ? null : keptFloor != null ? Math.round((bal - keptFloor) * 100) / 100 : reportedRemaining,
      maxDrawdown: n(c.values.maxDrawdown),
      dailyLossLimit: n(c.values.dailyLossLimit),
      profitTarget: n(c.values.profitTarget),
      profitTargetBalance: n(c.values.profitTargetBalance),
      netPnl: n(c.values.netPnl),
      dailyPnl: n(c.values.dailyPnl),
      equity: n(c.values.equity),
      unrealizedPnl: n(c.values.unrealizedPnl),
      statusText: typeof c.values.status === 'string' ? c.values.status : null,
      tradingDays: n(c.values.tradingDays),
      drawdownType: (DRAWDOWN_TYPES as readonly string[]).includes(String(c.values.drawdownType)) ? (c.values.drawdownType as (typeof DRAWDOWN_TYPES)[number]) : null,
      // Unknown = neither on the screenshot nor known to the account (verified / saved rules are known).
      missing: SNAPSHOT_FIELDS.filter((k) => c.values[k] == null && !(k === 'maxDrawdown' && maxDd != null) && !(k === 'dailyLossLimit' && (next.rules.dailyLossLimit != null || next.rules.calc?.dailyLossMode === 'none')) && !(k === 'profitTarget' && next.rules.profitTarget != null)),
      ...(c.reset ? { reset: true } : {}),
    },
    history: [record, ...prev.history].slice(0, HISTORY_CAP),
  };
  if (!keepThreshold && firmFloor != null) applied.push('drawdownThreshold');
  const typed = new Set(Object.entries(c.sources).filter(([, v]) => v?.source === 'user' || v?.edited).map(([k]) => k));
  const stamped = stampImportOrigins(next, applied, c.confirmedAt, typed);
  Object.assign(next, stamped);
  return { account: next, record, floorCheck };
}

/**
 * Undo the latest confirmed update (screenshot or manual): the account goes back to the values
 * it had before, and the record stays in the history marked as undone. Only the newest, not yet
 * undone record can be reverted — older ones are superseded by later updates.
 */
export { snapshotValues };

export function undoLatestUpdate(account: Account, recordId: string, now: Date): { ok: true; account: Account } | { ok: false; reason: string } {
  const st = account.importState;
  const latest = st?.history.find((r) => !r.undoneAt);
  if (!st || !latest || latest.id !== recordId) return { ok: false, reason: 'Only the most recent update can be undone.' };
  if (!latest.previous) return { ok: false, reason: 'This update was saved by an older version and cannot be undone automatically — correct the values in Edit Account Details.' };
  // Journal P&L booked after this update would be lost by restoring the old balance.
  const bal = st.origins?.balance;
  if (bal?.source === 'calculated' && Date.parse(bal.at) > Date.parse(latest.at))
    return { ok: false, reason: 'Trades were journaled after this update, so undoing it would lose their P&L. Correct the values in Edit Account Details instead.' };
  const p = latest.previous;
  const at = now.toISOString();
  return {
    ok: true,
    account: {
      ...account,
      balance: p.balance,
      highWaterMark: p.highWaterMark,
      startingBalance: p.startingBalance,
      cycleStartBalance: p.cycleStartBalance,
      status: p.status,
      rules: structuredClone(p.rules),
      importState: {
        ...st,
        threshold: p.threshold ?? null,
        reported: p.reported ?? null,
        origins: p.origins ?? undefined,
        editedAt: at,
        history: st.history.map((r) => (r.id === recordId ? { ...r, undoneAt: at } : r)),
      },
    },
  };
}
