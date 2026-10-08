import type { Account, AccountImportRecord, AccountImportState } from '@/types/domain';

import { drawdownFloor, maxDrawdownAmount } from '../propRuleEngine';
import type { ExtractedField, FieldKey, FieldSource } from './types';

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
}

const HISTORY_CAP = 30;
const TOL = 1;
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Rule fields a screenshot may never change on this account (loaded from a verified program and not overridden). */
export function lockedRuleFields(account: Account | null): Set<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget'> {
  const out = new Set<'maxDrawdown' | 'dailyLossLimit' | 'profitTarget'>();
  const link = account?.firmLink;
  if (!link || link.status !== 'verified') return out;
  for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) if (!link.overrides.includes(k)) out.add(k);
  // A verified "no daily loss limit" is also a verified value.
  if (link.calc?.dailyLossMode === 'none') out.add('dailyLossLimit');
  return out;
}

/** Build the confirmed import from reviewed fields. */
export function confirmImport(input: {
  fields: Partial<Record<FieldKey, ExtractedField | null>>;
  edited: Set<FieldKey>;
  ruleUpdates?: ConfirmedImport['ruleUpdates'];
  fingerprint: string | null;
  maskedId: string | null;
  engine: ConfirmedImport['engine'];
  pages: number;
  now: Date;
}): ConfirmedImport {
  const values: ConfirmedImport['values'] = {};
  const sources: ConfirmedImport['sources'] = {};
  for (const [k, f] of Object.entries(input.fields) as [FieldKey, ExtractedField | null][]) {
    if (!f) continue;
    values[k] = f.value;
    const edited = input.edited.has(k);
    sources[k] = { source: edited ? 'user' : f.source, confidence: edited ? null : f.confidence, edited };
  }
  return { values, sources, ruleUpdates: input.ruleUpdates ?? {}, fingerprint: input.fingerprint, maskedId: input.maskedId, engine: input.engine, pages: input.pages, confirmedAt: input.now.toISOString() };
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

  // Rule values: only ones the trader chose, never verified ones.
  const locked = lockedRuleFields(account);
  for (const [k, v] of Object.entries(c.ruleUpdates) as ['maxDrawdown' | 'dailyLossLimit' | 'profitTarget', number][]) {
    if (locked.has(k)) {
      notes.push(`${k} kept from the verified program rules.`);
      continue;
    }
    if (v > 0) {
      next.rules[k] = v;
      notes.push(`${k} set from the screenshot (unverified).`);
    }
  }

  const balance = n(c.values.balance);
  if (balance != null) next.balance = balance;
  const bal = next.balance;

  // Drawdown tracking.
  const maxDd = maxDrawdownAmount(next);
  const reportedThreshold = n(c.values.drawdownThreshold);
  const reportedRemaining = n(c.values.drawdownRemaining);
  const used = n(c.values.currentDrawdown);
  const firmFloor = reportedThreshold ?? (reportedRemaining != null ? bal - reportedRemaining : null);
  let hwm = Math.max(account.highWaterMark, bal);
  if (next.rules.drawdownType !== 'static' && maxDd) {
    const lockOffset = next.rules.calc?.trailingLockOffset ?? (next.rules.trailingLocksAtStart ? 0 : null);
    const lock = lockOffset != null ? next.startingBalance + lockOffset : null;
    if (firmFloor != null) {
      const fromFloor = firmFloor + maxDd;
      // At the lock the floor no longer tells us the peak; keep what we know.
      hwm = lock != null && firmFloor >= lock - TOL ? Math.max(account.highWaterMark, bal, fromFloor) : Math.max(next.startingBalance, fromFloor, bal);
    } else if (used != null) {
      hwm = Math.max(next.startingBalance, bal + used);
    }
  }
  next.highWaterMark = Math.round(hwm * 100) / 100;

  let floorCheck: ApplyResult['floorCheck'] = null;
  if (firmFloor != null) {
    const calculated = drawdownFloor(next);
    const matches = calculated != null && Math.abs(calculated - firmFloor) <= TOL;
    floorCheck = { reported: firmFloor, calculated, matches };
    if (calculated == null) notes.push('No max drawdown on this account — the firm’s threshold is shown as reported.');
    else if (!matches) notes.push(`The firm shows a threshold of $${firmFloor.toLocaleString('en-US')}; the account’s rules calculate $${calculated.toLocaleString('en-US')}. Check the drawdown rules or the screenshot.`);
  }

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
  };

  const prev: AccountImportState = account.importState ?? { fingerprint: null, maskedId: null, reported: null, history: [] };
  next.importState = {
    fingerprint: prev.fingerprint ?? c.fingerprint,
    maskedId: c.maskedId ?? prev.maskedId,
    reported: {
      at: c.confirmedAt,
      balance,
      drawdownThreshold: firmFloor,
      drawdownRemaining: reportedRemaining ?? (firmFloor != null ? Math.round((bal - firmFloor) * 100) / 100 : null),
      maxDrawdown: n(c.values.maxDrawdown),
      dailyLossLimit: n(c.values.dailyLossLimit),
    },
    history: [record, ...prev.history].slice(0, HISTORY_CAP),
  };
  return { account: next, record, floorCheck };
}
