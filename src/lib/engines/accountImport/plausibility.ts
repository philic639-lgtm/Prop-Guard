import type { FirmRulesDatabase } from '@/data/propFirms/types';

import { findFirm } from '../firmRulesEngine';
import { FIELD_LABEL, type AmbiguousReading, type ExtractedField, type FieldKey, type FieldMap, type ImportCheck } from './types';

/**
 * Plausibility of screenshot readings, BEFORE they can reach the review.
 *
 * OCR on a photo of a screen misreads digits ("25K" → "35K", "$24,402 MLL" → "$5"). A reading
 * that cannot be the field it sits next to — an account size the firm does not sell, a $5
 * minimum balance on a $25,000 account, a balance far from the account's size — is NOT kept as
 * a value the trader could wave through with "Looks right": it becomes an ambiguous reading
 * ("Needs confirmation") and the trader types the value from the dashboard. Nothing is replaced
 * with a guess; values the trader typed are never removed.
 */

export interface PlausibilityContext {
  /** Account sizes the detected firm sells (rules database); null = firm unknown. */
  sizes?: number[] | null;
  /** Update: the account being updated — its size is the reference, and stays its size. */
  account?: { size: number; startingBalance: number } | null;
  firmName?: string | null;
}

/** Sizes the firm offers (any program), from the rules database. */
export function offeredSizes(db: FirmRulesDatabase, firmName: string | null | undefined): number[] | null {
  const firm = findFirm(db, firmName);
  if (!firm) return null;
  const sizes = [...new Set(db.programs.filter((p) => p.firmId === firm.id && p.accountSize != null).map((p) => p.accountSize as number))].sort((a, b) => a - b);
  return sizes.length ? sizes : null;
}

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const k = (n: number) => `${Math.round(n / 1000)}K`;

/** Allowed range for a field, relative to the account's size (or, failing that, its balance). */
function range(key: FieldKey, ref: number | null): [number, number] | null {
  if (ref == null) {
    // No reference at all: only obviously wrong values (a balance level of a few dollars).
    if (key === 'balance' || key === 'drawdownThreshold' || key === 'profitTargetBalance' || key === 'startingBalance') return [1000, Infinity];
    if (key === 'maxDrawdown') return [100, Infinity];
    if (key === 'dailyLossLimit') return [50, Infinity];
    return null;
  }
  switch (key) {
    case 'balance':
    case 'equity':
      return [ref * 0.5, ref * 2];
    case 'startingBalance':
      return [ref * 0.5, ref * 1.5];
    case 'drawdownThreshold':
      return [ref * 0.75, ref * 1.05];
    case 'maxDrawdown':
      return [100, ref * 0.2];
    case 'dailyLossLimit':
      return [50, ref * 0.1];
    case 'profitTarget':
      return [100, ref * 0.3];
    case 'profitTargetBalance':
      return [ref, ref * 1.35];
    case 'profitRemaining':
      return [0, ref * 0.35];
    case 'drawdownRemaining':
      return [-ref * 0.25, ref * 0.25];
    case 'currentDrawdown':
      return [0, ref * 0.25];
    case 'netPnl':
      return [-ref, ref];
    case 'dailyPnl':
      return [-ref * 0.25, ref * 0.25];
    default:
      return null;
  }
}

export function checkPlausibility(input: FieldMap, ctx: PlausibilityContext = {}): { fields: FieldMap; ambiguous: AmbiguousReading[]; checks: ImportCheck[] } {
  const fields: FieldMap = { ...input };
  const ambiguous: AmbiguousReading[] = [];
  const checks: ImportCheck[] = [];
  const firm = ctx.firmName ?? (typeof fields.firm?.value === 'string' ? fields.firm.value : null);

  /** Keep only the readings `ok` accepts; the rest become "needs confirmation" with `why`. */
  const filter = (key: FieldKey, ok: (v: number) => boolean, why: (v: number) => string) => {
    const f = fields[key];
    if (!f || f.source === 'user' || f.source === 'derived') return;
    const readings = [{ value: f.value, confidence: f.confidence, page: f.page }, ...(f.alternatives ?? [])];
    const keep = readings.filter((r) => typeof r.value !== 'number' || ok(r.value));
    for (const r of readings) if (typeof r.value === 'number' && !keep.includes(r)) ambiguous.push({ key, value: r.value, reason: why(r.value), evidence: f.evidence, page: r.page });
    if (keep.length === readings.length) return;
    if (!keep.length) {
      delete fields[key];
      return;
    }
    const [best, ...rest] = keep;
    const next: ExtractedField = { ...f, value: best.value, confidence: best.page === f.page && best.value === f.value ? f.confidence : best.confidence, page: best.page };
    delete next.alternatives;
    if (rest.length) next.alternatives = rest;
    fields[key] = next;
  };

  // 1. Account size: one the firm sells, and — on an update — the account's own unless clearly shown otherwise.
  if (ctx.sizes?.length) {
    filter('accountSize', (v) => ctx.sizes!.includes(v), (v) => `${k(v)} is not an account size ${firm ?? 'this firm'} offers (${ctx.sizes!.map(k).join(', ')}) — probably misread. Needs confirmation.`);
  }
  if (ctx.account && fields.accountSize && fields.accountSize.source !== 'user') {
    const f = fields.accountSize;
    // A different size read with less than high confidence is an OCR slip, not a different account.
    if (typeof f.value === 'number' && Math.abs(f.value - ctx.account.size) > 1 && (f.confidence < 0.85 || f.alternatives?.length)) {
      ambiguous.push({ key: 'accountSize', value: f.value, reason: `The screenshot title reads ${k(f.value)}, but the reading is uncertain — this account stays ${usd(ctx.account.size)}.`, evidence: f.evidence, page: f.page });
      delete fields.accountSize;
    }
  }

  // 2. Reference: the account's size, else a valid size read, else the balance.
  const size = ctx.account?.size ?? (typeof fields.accountSize?.value === 'number' && !fields.accountSize.alternatives?.length ? fields.accountSize.value : null);
  if (size != null) filter('balance', (v) => v >= size * 0.5 && v <= size * 2, (v) => `${usd(v)} cannot be the balance of a ${usd(size)} account — misread. Needs confirmation.`);
  const bal = typeof fields.balance?.value === 'number' && !fields.balance.alternatives?.length ? fields.balance.value : null;
  const ref = size ?? (bal != null && bal >= 1000 ? bal : null);

  const NAMES: Partial<Record<FieldKey, string>> = { drawdownThreshold: 'minimum balance (MLL floor)', maxDrawdown: 'max loss allowance', dailyLossLimit: 'daily loss limit' };
  for (const key of ['startingBalance', 'drawdownThreshold', 'maxDrawdown', 'dailyLossLimit', 'profitTarget', 'profitTargetBalance', 'profitRemaining', 'drawdownRemaining', 'currentDrawdown', 'netPnl', 'dailyPnl', 'equity'] as FieldKey[]) {
    const r = range(key, ref);
    if (!r) continue;
    const name = NAMES[key] ?? FIELD_LABEL[key].toLowerCase();
    filter(
      key,
      (v) => v >= r[0] && v <= r[1],
      (v) => (ref != null ? `${usd(v)} is not a plausible ${name} for a ${usd(ref)} account — misread. Enter the value from your dashboard.` : `${usd(v)} is not a plausible ${name} — misread. Enter the value from your dashboard.`),
    );
  }
  // Without a size, a minimum balance above the balance by more than a rounding slip is a misread too.
  const thr = fields.drawdownThreshold;
  if (bal != null && thr && thr.source !== 'user' && typeof thr.value === 'number' && thr.value > bal * 1.05) {
    ambiguous.push({ key: 'drawdownThreshold', value: thr.value, reason: `${usd(thr.value)} is above the balance ${usd(bal)} — not a plausible minimum balance. Needs confirmation.`, evidence: thr.evidence, page: thr.page });
    delete fields.drawdownThreshold;
  }

  for (const a of ambiguous)
    checks.push({ id: `implausible:${a.key}:${a.value}`, status: 'warning', fields: [a.key], message: a.reason });
  return { fields, ambiguous, checks };
}
