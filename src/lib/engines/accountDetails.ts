import type { Account, AccountDetailKey, AccountImportRecord, AccountImportState, AccountSnapshotValues, AccountStatus, AccountValueSource, DrawdownType, FirmRuleField } from '@/types/domain';
import { dayKey } from '@/utils/dates';

import { calcAfterOverrides } from './firmRulesEngine';
import { confirmedThreshold, floorStatus, maxDrawdownAmount } from './propRuleEngine';
import type { FloorResult } from './setupCheck/drawdown';

/**
 * Account details — what the trader sees and edits on "Edit Account Details"
 * and the import review, with WHERE every value comes from:
 *
 *   screenshot        read from a dashboard screenshot (confirmed by the trader)
 *   verified_program  the verified firm program configuration
 *   calculated        calculated from verified / confirmed inputs (or the journal)
 *   manual            entered or corrected by the trader
 *   missing           not known — shown empty with an explanation, never guessed
 *
 * Manual corrections are tracked per field and are never overwritten by a later
 * screenshot import unless the trader chooses the screenshot value (see
 * `manualConflicts`). Screenshot data is never "live".
 */

export type DetailOrigin = AccountValueSource | 'missing';

export const ORIGIN_LABEL: Record<DetailOrigin, string> = {
  screenshot: 'Extracted from screenshot',
  verified_program: 'Verified program configuration',
  calculated: 'Calculated from verified inputs',
  manual: 'Entered or corrected by you',
  missing: 'Missing — needs confirmation',
};
export const ORIGIN_SHORT: Record<DetailOrigin, string> = { screenshot: 'Screenshot', verified_program: 'Verified rule', calculated: 'Calculated', manual: 'Entered by you', missing: 'Missing' };

export const DETAIL_LABEL: Record<AccountDetailKey | 'personalDailyRisk', string> = {
  name: 'Account name',
  firm: 'Prop firm',
  accountSize: 'Account size',
  balance: 'Current balance',
  startingBalance: 'Starting balance',
  profitTarget: 'Profit target (amount)',
  drawdownThreshold: 'Current liquidation threshold',
  maxDrawdown: 'Maximum drawdown (amount)',
  dailyLossLimit: 'Firm daily loss limit',
  drawdownType: 'Drawdown type',
  status: 'Account status',
  personalDailyRisk: 'Personal daily risk budget',
};

export const DRAWDOWN_TYPE_NAME: Record<DrawdownType, string> = { static: 'Static', eod_trailing: 'End-of-day trailing', trailing: 'Intraday trailing' };
export const STATUS_NAME: Record<AccountStatus, string> = { active: 'Active', passed: 'Passed', failed: 'Failed', archived: 'Archived' };

/** Values the edit screen works with (null = empty / not known). */
export interface DetailValues {
  name: string;
  firm: string;
  accountSize: number | null;
  balance: number | null;
  startingBalance: number | null;
  profitTarget: number | null;
  drawdownThreshold: number | null;
  maxDrawdown: number | null;
  dailyLossLimit: number | null;
  drawdownType: DrawdownType | null;
  status: AccountStatus;
  /** The trader's own daily stop — a personal plan setting, applies to every account. */
  personalDailyRisk: number | null;
}

export interface DetailField<V = number | string | null> {
  value: V;
  origin: DetailOrigin;
  /** When the value was last set (screenshot / edit), if known. */
  at: string | null;
  note?: string;
}

export interface AccountDetailsView {
  fields: { [K in keyof DetailValues]: DetailField<DetailValues[K]> };
  /** Program name from the firm link (read-only here; change it on the full account form). */
  program: string | null;
  programVerified: boolean;
  /** Current drawdown floor and how it is known. */
  floor: FloorResult;
  /** Balance − threshold, only when both are known. */
  drawdownRemaining: DetailField<number | null>;
  /** Profit so far / target (0–1), only from a known starting balance. */
  targetProgress: number | null;
}

type RuleKey = 'maxDrawdown' | 'dailyLossLimit' | 'profitTarget' | 'drawdownType';
const cents = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A verified program states this rule (and the trader has not overridden it). */
function verifiedRule(account: Account, key: RuleKey | 'accountSize'): boolean {
  const link = account.firmLink;
  if (!link || link.status !== 'verified') return false;
  const field: FirmRuleField = key === 'accountSize' ? 'size' : key;
  if (link.overrides.includes(field)) return false;
  if (key === 'dailyLossLimit' && account.rules.calc?.dailyLossMode === 'none') return true;
  return String(link.imported?.[field] ?? '').trim() !== '';
}

/** Where an account value comes from (explicit record first, then what the account itself shows). */
export function originOf(account: Account, key: AccountDetailKey): DetailField['origin'] {
  const st = account.importState;
  if ((st?.unconfirmed ?? []).includes(key)) return 'missing';
  const recorded = st?.origins?.[key]?.source;
  if (key === 'drawdownThreshold') {
    const t = confirmedThreshold(account);
    if (t) return t.source;
    const f = floorStatus(account);
    return f.floor != null ? 'calculated' : 'missing';
  }
  if ((key === 'maxDrawdown' || key === 'dailyLossLimit' || key === 'profitTarget' || key === 'drawdownType' || key === 'accountSize') && verifiedRule(account, key)) return 'verified_program';
  if (recorded) return recorded;
  const v = valueOf(account, key);
  if (v == null || v === '') return 'missing';
  if (key === 'balance' && st?.reported?.balance != null && Math.abs(st.reported.balance - account.balance) < 0.005) return 'screenshot';
  // Older accounts: values typed on the account form.
  return 'manual';
}

function valueOf(account: Account, key: AccountDetailKey): number | string | null {
  switch (key) {
    case 'name':
      return account.name;
    case 'firm':
      return account.firm;
    case 'accountSize':
      return account.size;
    case 'balance':
      return account.balance;
    case 'startingBalance':
      return account.startingBalance;
    case 'profitTarget':
      return account.rules.profitTarget;
    case 'drawdownThreshold':
      return floorStatus(account).floor;
    case 'maxDrawdown':
      return maxDrawdownAmount(account);
    case 'dailyLossLimit':
      return account.rules.dailyLossLimit;
    case 'drawdownType':
      return account.rules.drawdownType;
    case 'status':
      return account.status;
  }
}

export function accountDetails(account: Account, personalDailyRisk: number | null): AccountDetailsView {
  const at = (k: AccountDetailKey) => account.importState?.origins?.[k]?.at ?? null;
  const field = <K extends AccountDetailKey>(k: K, value: DetailValues[K], note?: string): DetailField<DetailValues[K]> => ({ value, origin: originOf(account, k), at: at(k), ...(note ? { note } : {}) });
  const floor = floorStatus(account);
  const thr = confirmedThreshold(account);
  const dllNone = account.rules.calc?.dailyLossMode === 'none';
  const fields: AccountDetailsView['fields'] = {
    name: field('name', account.name),
    firm: field('firm', account.firm),
    accountSize: field('accountSize', account.size),
    balance: field('balance', account.balance),
    startingBalance: field('startingBalance', account.startingBalance),
    profitTarget: field('profitTarget', account.rules.profitTarget),
    drawdownThreshold: { value: floor.floor, origin: originOf(account, 'drawdownThreshold'), at: thr?.at ?? null, note: floor.reason },
    maxDrawdown: field('maxDrawdown', maxDrawdownAmount(account)),
    dailyLossLimit: field('dailyLossLimit', account.rules.dailyLossLimit, dllNone ? 'This plan has no daily loss limit (verified).' : undefined),
    drawdownType: field('drawdownType', account.rules.drawdownType),
    status: field('status', account.status),
    personalDailyRisk: { value: personalDailyRisk != null && personalDailyRisk > 0 ? personalDailyRisk : null, origin: personalDailyRisk != null && personalDailyRisk > 0 ? 'manual' : 'missing', at: null, note: 'Your own daily stop — applies to all your accounts.' },
  };
  const remaining = floor.floor != null ? cents(account.balance - floor.floor) : null;
  const target = account.rules.profitTarget;
  return {
    fields,
    program: account.firmLink?.programName ?? null,
    programVerified: account.firmLink?.status === 'verified',
    floor,
    drawdownRemaining: remaining != null ? { value: remaining, origin: 'calculated', at: null, note: 'Balance − liquidation threshold' } : { value: null, origin: 'missing', at: null, note: floor.reason },
    targetProgress: target != null && target > 0 ? Math.max(0, Math.min(1, (account.balance - account.cycleStartBalance) / target)) : null,
  };
}

// ───────────────────────────── Editing ─────────────────────────────

export function detailValues(account: Account, personalDailyRisk: number | null): DetailValues {
  const v = accountDetails(account, personalDailyRisk).fields;
  // The threshold field shows only a CONFIRMED threshold (or a rule calculation as a placeholder elsewhere) —
  // the editor never pre-fills a value the trader did not confirm.
  const confirmed = confirmedThreshold(account)?.value ?? null;
  return {
    name: v.name.value,
    firm: v.firm.value,
    accountSize: v.accountSize.value,
    balance: v.balance.value,
    startingBalance: v.startingBalance.value,
    profitTarget: v.profitTarget.value,
    drawdownThreshold: confirmed,
    maxDrawdown: account.rules.maxDrawdown,
    dailyLossLimit: v.dailyLossLimit.value,
    drawdownType: (account.importState?.unconfirmed ?? []).includes('drawdownType') ? null : account.rules.drawdownType,
    status: v.status.value,
    personalDailyRisk: v.personalDailyRisk.value,
  };
}

export interface DetailValidation {
  errors: Partial<Record<keyof DetailValues, string>>;
  /** Not blocking, shown before saving. */
  warnings: string[];
}

/** Parse a money input: "" → null; anything that is not a finite number → NaN (invalid). Commas and "$" allowed. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (t === '') return null;
  if (!/^-?\d*\.?\d+$/.test(t)) return Number.NaN;
  return Number(t);
}

export function validateDetails(v: DetailValues, kind: Account['kind']): DetailValidation {
  const errors: DetailValidation['errors'] = {};
  const warnings: string[] = [];
  const positive = (k: keyof DetailValues, required: boolean, label: string) => {
    const x = v[k] as number | null;
    if (x == null) {
      if (required) errors[k] = `Enter the ${label.toLowerCase()}.`;
      return;
    }
    if (!Number.isFinite(x)) errors[k] = 'Enter a number, e.g. 25000.';
    else if (x <= 0) errors[k] = 'Must be more than zero — a negative or zero amount is not valid here.';
  };
  if (!v.name.trim()) errors.name = 'Name the account.';
  positive('accountSize', true, 'Account size');
  positive('balance', true, 'Current balance');
  positive('startingBalance', false, 'Starting balance');
  positive('profitTarget', false, 'Profit target');
  positive('drawdownThreshold', false, 'Liquidation threshold');
  positive('maxDrawdown', false, 'Maximum drawdown');
  positive('dailyLossLimit', false, 'Daily loss limit');
  positive('personalDailyRisk', false, 'Personal daily risk');

  const ok = (k: keyof DetailValues) => !errors[k] && finite(v[k]) && (v[k] as number) > 0;
  if (ok('maxDrawdown') && ok('accountSize') && v.maxDrawdown! >= v.accountSize!) errors.maxDrawdown = 'The drawdown allowance must be smaller than the account size (enter the amount, e.g. 1500 — not a balance).';
  if (ok('drawdownThreshold') && ok('balance') && v.drawdownThreshold! >= v.balance!)
    errors.drawdownThreshold = 'The liquidation threshold must be below the current balance. If the account has already hit it, set the status to Failed.';
  if (ok('profitTarget') && ok('accountSize') && v.profitTarget! >= v.accountSize!) warnings.push('The profit target looks like a balance level. Enter the profit AMOUNT still required in total (e.g. 1500), not the target balance.');
  if (ok('dailyLossLimit') && ok('maxDrawdown') && v.dailyLossLimit! > v.maxDrawdown!) warnings.push('The daily loss limit is larger than the maximum drawdown — check both values.');
  if (ok('personalDailyRisk') && ok('dailyLossLimit') && v.personalDailyRisk! > v.dailyLossLimit!) warnings.push('Your personal daily risk is above the firm’s daily loss limit — the firm limit is the one that applies.');
  if (ok('drawdownThreshold') && ok('balance') && ok('maxDrawdown') && v.balance! - v.drawdownThreshold! > v.maxDrawdown! + 0.5)
    warnings.push('The cushion (balance − threshold) is larger than the maximum drawdown — one of the values is probably not current.');
  const start = ok('startingBalance') ? v.startingBalance! : null;
  if (v.drawdownType === 'static' && start != null && ok('maxDrawdown') && ok('drawdownThreshold') && Math.abs(start - v.maxDrawdown! - v.drawdownThreshold!) > 0.5)
    warnings.push(`For a static drawdown the threshold is usually starting balance − allowance (${(start - v.maxDrawdown!).toLocaleString('en-US')}). Check the value on your dashboard.`);
  if (kind === 'prop' && v.drawdownThreshold == null && v.drawdownType !== 'static')
    warnings.push('No liquidation threshold: drawdown will show “Needs verification” and Prop Guard will not suggest trade sizes for this account.');
  if (kind === 'prop' && v.drawdownType == null) warnings.push('Drawdown type not confirmed — choose static, end-of-day or intraday trailing.');
  return { errors, warnings };
}

export interface DetailChange {
  key: keyof DetailValues;
  label: string;
  before: string;
  after: string;
}

const show = (k: keyof DetailValues, v: unknown): string => {
  if (v == null || v === '') return 'Not set';
  if (k === 'drawdownType') return DRAWDOWN_TYPE_NAME[v as DrawdownType] ?? String(v);
  if (k === 'status') return STATUS_NAME[v as AccountStatus] ?? String(v);
  if (typeof v === 'number') return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return String(v);
};
const same = (a: unknown, b: unknown) => (finite(a) && finite(b) ? Math.abs(a - b) < 0.005 : (a ?? null) === (b ?? null) || String(a ?? '').trim() === String(b ?? '').trim());

/** What "Save Changes" will change (shown before saving). */
export function detailChanges(before: DetailValues, after: DetailValues): DetailChange[] {
  return (Object.keys(after) as (keyof DetailValues)[]).filter((k) => !same(before[k], after[k])).map((k) => ({ key: k, label: DETAIL_LABEL[k], before: show(k, before[k]), after: show(k, after[k]) }));
}

const EMPTY_STATE: AccountImportState = { fingerprint: null, maskedId: null, reported: null, history: [] };

/**
 * Apply the trader's edits. Only changed fields are written and each becomes
 * `manual`. A verified rule the trader changes becomes an override of the firm
 * rules (its typed calculations are dropped, as on the account form). The
 * personal daily risk is returned for the trader's own rules (it is not an
 * account value).
 */
export function applyDetailEdits(account: Account, before: DetailValues, after: DetailValues, now: Date): { account: Account; personalDailyRisk: number | null; changes: DetailChange[] } {
  const changes = detailChanges(before, after);
  const at = now.toISOString();
  const changed = new Set(changes.map((c) => c.key));
  const next: Account = { ...account, rules: { ...account.rules } };
  const st: AccountImportState = { ...EMPTY_STATE, ...account.importState, origins: { ...account.importState?.origins } };
  const mark = (k: AccountDetailKey) => {
    st.origins![k] = { source: 'manual', at };
    st.unconfirmed = (st.unconfirmed ?? []).filter((x) => x !== k);
  };

  if (changed.has('name')) {
    next.name = after.name.trim().slice(0, 60);
    mark('name');
  }
  if (changed.has('firm')) {
    next.firm = after.firm.trim().slice(0, 60);
    mark('firm');
  }
  if (changed.has('status')) {
    next.status = after.status;
    mark('status');
  }
  if (changed.has('accountSize') && after.accountSize != null) {
    next.size = after.accountSize;
    mark('accountSize');
  }
  if (changed.has('startingBalance') && after.startingBalance != null) {
    // The cycle starts with the account unless a payout cycle already moved it.
    if (Math.abs(account.cycleStartBalance - account.startingBalance) < 0.005) next.cycleStartBalance = after.startingBalance;
    next.startingBalance = after.startingBalance;
    mark('startingBalance');
  }
  if (changed.has('balance') && after.balance != null) {
    next.balance = after.balance;
    next.highWaterMark = Math.max(account.highWaterMark, after.balance);
    mark('balance');
  }

  // Rules — an edit of a verified rule is an explicit override.
  const link = account.firmLink ? { ...account.firmLink, overrides: [...account.firmLink.overrides] } : undefined;
  const override = (f: FirmRuleField) => {
    if (link?.status === 'verified' && String(link.imported?.[f] ?? '').trim() !== '' && !link.overrides.includes(f)) link.overrides.push(f);
  };
  if (changed.has('maxDrawdown')) {
    next.rules.maxDrawdown = after.maxDrawdown;
    if (next.rules.calc?.maxDrawdownPct != null) next.rules.calc = { ...next.rules.calc, maxDrawdownPct: null };
    override('maxDrawdown');
    mark('maxDrawdown');
  }
  if (changed.has('dailyLossLimit')) {
    next.rules.dailyLossLimit = after.dailyLossLimit;
    override('dailyLossLimit');
    mark('dailyLossLimit');
  }
  if (changed.has('profitTarget')) {
    next.rules.profitTarget = after.profitTarget;
    override('profitTarget');
    mark('profitTarget');
  }
  if (changed.has('drawdownType') && after.drawdownType) {
    next.rules.drawdownType = after.drawdownType;
    override('drawdownType');
    mark('drawdownType');
  }
  if (link) {
    next.firmLink = link;
    if (link.status === 'verified') {
      const calc = calcAfterOverrides(link.calc, link.overrides, after.dailyLossLimit == null ? '' : String(after.dailyLossLimit));
      if (calc) next.rules.calc = calc;
      else delete next.rules.calc;
    }
  }

  // The liquidation threshold the trader entered (or cleared).
  if (changed.has('drawdownThreshold')) {
    if (after.drawdownThreshold == null) {
      st.threshold = null;
      if (st.reported) st.reported = { ...st.reported, drawdownThreshold: null };
      delete st.origins!.drawdownThreshold;
    } else {
      const thr = after.drawdownThreshold;
      st.threshold = { value: thr, source: 'manual', at };
      mark('drawdownThreshold');
      // Keep the high-water mark consistent with the entered threshold so later journaled gains trail
      // it correctly (and an older, higher peak can never silently override the trader's number).
      const dd = maxDrawdownAmount(next);
      if (next.rules.drawdownType !== 'static' && dd != null) {
        const lockOffset = next.rules.calc?.trailingLockOffset ?? (next.rules.trailingLocksAtStart ? 0 : null);
        const locked = lockOffset != null && thr >= next.startingBalance + lockOffset - 0.5;
        next.highWaterMark = cents(locked ? Math.max(next.startingBalance, next.balance, thr + dd) : Math.max(next.startingBalance, thr + dd));
      }
    }
  }
  // A rule change never moves a threshold the trader or a screenshot confirmed.

  const record: AccountImportRecord = {
    id: `edit-${now.getTime().toString(36)}`,
    at,
    engine: 'manual',
    pages: 0,
    fields: changes.filter((c) => c.key !== 'personalDailyRisk').map((c) => ({ key: c.key, value: c.after, confidence: null, source: 'user' as const, edited: true })),
    before: { balance: account.balance, highWaterMark: account.highWaterMark },
    after: { balance: next.balance, highWaterMark: next.highWaterMark },
    notes: changes.map((c) => `${c.label}: ${c.before} → ${c.after} (edited by you)`),
    previous: snapshotValues(account),
  };
  st.editedAt = at;
  if (record.fields.length) st.history = [record, ...(st.history ?? [])].slice(0, 30);
  next.importState = st;
  return { account: next, personalDailyRisk: after.personalDailyRisk, changes };
}

/** The values an update may change — kept on each history record so the latest update can be undone. */
export function snapshotValues(a: Account): AccountSnapshotValues {
  const st = a.importState;
  return {
    balance: a.balance,
    highWaterMark: a.highWaterMark,
    startingBalance: a.startingBalance,
    cycleStartBalance: a.cycleStartBalance,
    status: a.status,
    rules: structuredClone(a.rules),
    threshold: st?.threshold ?? null,
    reported: st?.reported ? structuredClone(st.reported) : null,
    origins: st?.origins ? structuredClone(st.origins) : null,
  };
}


// ───────────────────────────── Freshness / completeness ─────────────────────────────

export interface AccountFreshness {
  /** Latest update of the account values (screenshot, edit, journal, or creation). */
  at: string;
  source: 'screenshot' | 'manual' | 'journal' | 'created';
  /** The dashboard date the latest screenshot showed (YYYY-MM-DD), if read. */
  asOf: string | null;
  ageHours: number;
  /** From an earlier trading day — balance and threshold may have moved since. */
  stale: boolean;
  label: string;
  /** What to tell the trader when stale (depends on where the numbers come from). */
  staleMessage: string | null;
}

export function accountFreshness(account: Account, now: Date): AccountFreshness {
  const st = account.importState;
  const cand: { at: string; source: AccountFreshness['source'] }[] = [];
  if (st?.reported?.at) cand.push({ at: st.reported.at, source: 'screenshot' });
  if (st?.editedAt) cand.push({ at: st.editedAt, source: 'manual' });
  if (st?.origins?.balance?.source === 'calculated') cand.push({ at: st.origins.balance.at, source: 'journal' });
  // Creation counts only when nothing has updated the values since.
  if (!cand.length) cand.push({ at: account.createdAt, source: 'created' });
  const latest = cand.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a));
  // A screenshot is as old as the dashboard it shows, not the moment it was imported.
  const asOf = latest.source === 'screenshot' ? (st?.reported?.asOf ?? null) : null;
  const effective = asOf && asOf < dayKey(latest.at) ? `${asOf}T12:00:00` : latest.at;
  const ageHours = Math.max(0, Math.round(((now.getTime() - Date.parse(effective)) / 3_600_000) * 10) / 10);
  const stale = dayKey(effective) !== dayKey(now);
  const day = new Date(effective).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const when = new Date(effective).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const what = { screenshot: 'Screenshot', manual: 'Edited by you', journal: 'From your journal', created: 'Entered when added' }[latest.source];
  const staleMessage = !stale
    ? null
    : latest.source === 'screenshot'
      ? `Stale data: the screenshot shows ${asOf ?? day}. Update your balance and threshold before trading.`
      : `Balance last confirmed ${day}. If you traded outside the journal since, update it.`;
  return { at: latest.at, source: latest.source, asOf, ageHours, stale, label: `${what} · ${asOf && latest.source === 'screenshot' ? `dashboard ${asOf}` : when}`, staleMessage };
}

export interface MissingItem {
  key: AccountDetailKey;
  message: string;
}

/** Critical information that is missing (separate from staleness). */
export function missingCritical(account: Account): MissingItem[] {
  if (account.kind !== 'prop') return [];
  const out: MissingItem[] = [];
  const floor = floorStatus(account);
  if (floor.floor == null) out.push({ key: 'drawdownThreshold', message: floor.reason });
  if ((account.importState?.unconfirmed ?? []).includes('drawdownType')) out.push({ key: 'drawdownType', message: 'Drawdown type not confirmed (static / end-of-day / intraday trailing).' });
  return out;
}

// ───────────────────────────── Imports vs manual corrections ─────────────────────────────

/** Screenshot field → account value it would replace. */
export const IMPORT_TO_DETAIL: Partial<Record<string, AccountDetailKey>> = {
  balance: 'balance',
  drawdownThreshold: 'drawdownThreshold',
  maxDrawdown: 'maxDrawdown',
  dailyLossLimit: 'dailyLossLimit',
  profitTarget: 'profitTarget',
  startingBalance: 'startingBalance',
  drawdownType: 'drawdownType',
};

export interface ManualConflict {
  key: AccountDetailKey;
  label: string;
  manual: number | string;
  screenshot: number | string;
  /** When the trader made the correction. */
  at: string;
}

/**
 * Values the trader corrected by hand that a new screenshot would change. The
 * import review asks for each one (keep mine / use the screenshot) — a manual
 * correction is never silently overwritten.
 */
export function manualConflicts(account: Account, values: Partial<Record<string, number | string | null>>): ManualConflict[] {
  const out: ManualConflict[] = [];
  for (const [field, key] of Object.entries(IMPORT_TO_DETAIL) as [string, AccountDetailKey][]) {
    const o = account.importState?.origins?.[key];
    if (o?.source !== 'manual') continue;
    const shot = values[field];
    if (shot == null || shot === '') continue;
    const current = key === 'drawdownThreshold' ? (confirmedThreshold(account)?.value ?? null) : valueOf(account, key);
    if (current == null || same(current, shot)) continue;
    out.push({ key, label: DETAIL_LABEL[key], manual: current, screenshot: shot, at: o.at });
  }
  return out;
}

/**
 * After a confirmed import: record where each value it set came from — the screenshot, or the
 * trader when they typed / corrected it during the review. Kept manual values stay manual.
 */
export function stampImportOrigins(account: Account, applied: AccountDetailKey[], at: string, typedByTrader: ReadonlySet<string> = new Set()): Account {
  if (!applied.length) return account;
  const st: AccountImportState = { ...EMPTY_STATE, ...account.importState, origins: { ...account.importState?.origins } };
  for (const k of applied) {
    st.origins![k] = { source: typedByTrader.has(k) ? 'manual' : 'screenshot', at };
    st.unconfirmed = (st.unconfirmed ?? []).filter((x) => x !== k);
  }
  return { ...account, importState: st };
}

/** A journaled trade changed the balance: the balance is now calculated from the journal. */
export function withJournalBalance(account: Account, balance: number, at: string): Account {
  const st = account.importState;
  return {
    ...account,
    balance,
    highWaterMark: Math.max(account.highWaterMark, balance),
    ...(st ? { importState: { ...st, origins: { ...st.origins, balance: { source: 'calculated', at } } } } : {}),
  };
}
