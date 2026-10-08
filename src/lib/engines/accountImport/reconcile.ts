import type { ExtractedField, Extraction, FieldKey, FieldMap, ImportCheck, PageExtraction } from './types';
import { ALL_FIELDS } from './types';

/**
 * Merge one or more screenshots and cross-check the numbers.
 *
 * - Several screenshots: the most confident reading of each field wins; a
 *   different value on another screenshot is kept as an alternative and the
 *   field is marked low-confidence (a conflict the trader resolves).
 * - Arithmetic checks tie the drawdown numbers together:
 *     balance − threshold = remaining, used + remaining = max drawdown,
 *     starting balance + net P&L = balance.
 *   Agreement raises confidence; disagreement flags the fields.
 * - Missing values are only CALCULATED from two read values (source
 *   `derived`, shown as "Calculated") — never guessed.
 */

const TOL = 1.5;
const num = (f: ExtractedField | undefined) => (f && typeof f.value === 'number' ? f.value : null);
const close = (a: number, b: number) => Math.abs(a - b) <= TOL;
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function sameValue(key: FieldKey, a: number | string, b: number | string): boolean {
  if (typeof a === 'number' && typeof b === 'number') return close(a, b);
  const x = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  // "LucidPro" and "LucidPro 50K Evaluation" describe the same program.
  return key === 'program' ? x.includes(y) || y.includes(x) : x === y;
}

export function mergePages(pages: PageExtraction[]): FieldMap {
  const out: FieldMap = {};
  for (const key of ALL_FIELDS) {
    const all = pages.map((p) => p.fields[key]).filter((f): f is ExtractedField => !!f).sort((a, b) => b.confidence - a.confidence);
    if (!all.length) continue;
    const best = { ...all[0] };
    const others = all.slice(1).filter((f) => !sameValue(key, f.value, best.value));
    if (others.length) {
      best.alternatives = others.map((f) => ({ value: f.value, confidence: f.confidence, page: f.page }));
      best.confidence = Math.min(best.confidence, 0.6);
    } else if (all.length > 1) {
      // Two screenshots agree.
      best.confidence = Math.min(1, Math.max(best.confidence, all[1].confidence) + 0.04);
    }
    out[key] = best;
  }
  return out;
}

const boost = (f: ExtractedField | undefined, to = 0.9) => {
  if (f && f.source !== 'derived' && f.source !== 'user') f.confidence = Math.max(f.confidence, Math.min(to, f.confidence + 0.35));
};
const flag = (f: ExtractedField | undefined, to = 0.55) => {
  if (f && f.source !== 'user') f.confidence = Math.min(f.confidence, to);
};
const derived = (key: FieldKey, value: number, from: ExtractedField[], evidence: string): ExtractedField => ({
  key,
  value: Math.round(value * 100) / 100,
  confidence: Math.round(Math.min(...from.map((f) => f.confidence)) * 0.95 * 100) / 100,
  source: 'derived',
  evidence,
  page: from[0].page,
});

/**
 * Cross-checks + calculated values on a field map (copied, never mutated).
 * Also used after the trader edits values: edits (`source: 'user'`) are
 * never down-rated, and fields the trader cleared are never re-derived.
 */
export function crossCheck(input: FieldMap, opts: { noDerive?: Set<FieldKey> } = {}): { fields: FieldMap; checks: ImportCheck[] } {
  const fields: FieldMap = {};
  for (const [k, f] of Object.entries(input) as [FieldKey, ExtractedField][]) if (f && f.source !== 'derived') fields[k] = { ...f };
  const checks: ImportCheck[] = [];
  const may = (k: FieldKey) => !opts.noDerive?.has(k);

  for (const [key, f] of Object.entries(fields) as [FieldKey, ExtractedField][]) {
    if (f.alternatives?.length) {
      const fmt = (v: number | string) => (typeof v === 'number' ? money(v) : v);
      checks.push({ id: `conflict:${key}`, status: 'conflict', fields: [key], message: `Screenshots disagree on this value: ${[f.value, ...f.alternatives.map((a) => a.value)].map(fmt).join(' vs ')}. Pick the correct one.` });
    }
  }

  // Calculated values (only from two values that were actually read).
  const bal = () => num(fields.balance);
  const thr = () => num(fields.drawdownThreshold);
  const rem = () => num(fields.drawdownRemaining);
  const max = () => num(fields.maxDrawdown);
  const used = () => num(fields.currentDrawdown);
  if (may('drawdownRemaining') && rem() == null && bal() != null && thr() != null)
    fields.drawdownRemaining = derived('drawdownRemaining', bal()! - thr()!, [fields.balance!, fields.drawdownThreshold!], 'Calculated: current balance − drawdown threshold');
  if (may('drawdownRemaining') && rem() == null && max() != null && used() != null)
    fields.drawdownRemaining = derived('drawdownRemaining', max()! - used()!, [fields.maxDrawdown!, fields.currentDrawdown!], 'Calculated: max drawdown − drawdown used');
  if (may('drawdownThreshold') && thr() == null && bal() != null && rem() != null && fields.drawdownRemaining!.source !== 'derived')
    fields.drawdownThreshold = derived('drawdownThreshold', bal()! - rem()!, [fields.balance!, fields.drawdownRemaining!], 'Calculated: current balance − remaining drawdown');

  // balance − threshold = remaining
  if (bal() != null && thr() != null && rem() != null && fields.drawdownRemaining!.source !== 'derived' && fields.drawdownThreshold!.source !== 'derived') {
    if (close(bal()! - thr()!, rem()!)) {
      [fields.balance, fields.drawdownThreshold, fields.drawdownRemaining].forEach((f) => boost(f));
      checks.push({ id: 'balance-threshold-remaining', status: 'consistent', fields: ['balance', 'drawdownThreshold', 'drawdownRemaining'], message: `Balance − threshold = remaining drawdown (${money(rem()!)}).` });
    } else {
      [fields.balance, fields.drawdownThreshold, fields.drawdownRemaining].forEach((f) => flag(f));
      checks.push({ id: 'balance-threshold-remaining', status: 'conflict', fields: ['balance', 'drawdownThreshold', 'drawdownRemaining'], message: `Balance − threshold (${money(bal()! - thr()!)}) does not equal the remaining drawdown (${money(rem()!)}). Check which number is which.` });
    }
  }
  // used + remaining = max drawdown
  if (max() != null && used() != null && rem() != null) {
    if (close(used()! + rem()!, max()!)) {
      [fields.maxDrawdown, fields.currentDrawdown, fields.drawdownRemaining].forEach((f) => boost(f));
      checks.push({ id: 'used-remaining-max', status: 'consistent', fields: ['maxDrawdown', 'currentDrawdown', 'drawdownRemaining'], message: `Drawdown used + remaining = max drawdown (${money(max()!)}).` });
    } else if (fields.drawdownRemaining!.source !== 'derived') {
      [fields.currentDrawdown, fields.drawdownRemaining].forEach((f) => flag(f));
      checks.push({ id: 'used-remaining-max', status: 'warning', fields: ['maxDrawdown', 'currentDrawdown', 'drawdownRemaining'], message: `Drawdown used + remaining (${money(used()! + rem()!)}) ≠ max drawdown (${money(max()!)}).` });
    }
  }
  // starting + net P&L = balance
  const start = num(fields.startingBalance);
  const pnl = num(fields.netPnl);
  if (start != null && pnl != null && bal() != null) {
    if (close(start + pnl, bal()!)) {
      [fields.startingBalance, fields.netPnl, fields.balance].forEach((f) => boost(f));
      checks.push({ id: 'start-pnl-balance', status: 'consistent', fields: ['startingBalance', 'netPnl', 'balance'], message: 'Starting balance + net P&L = current balance.' });
    } else {
      flag(fields.netPnl, 0.65);
      checks.push({ id: 'start-pnl-balance', status: 'warning', fields: ['startingBalance', 'netPnl', 'balance'], message: 'Starting balance + net P&L does not equal the balance — the P&L may cover a different period.' });
    }
  }

  // Plausibility: a drawdown AMOUNT is small; a THRESHOLD and a BALANCE are account-sized.
  const size = num(fields.accountSize) ?? num(fields.startingBalance);
  if (max() != null && (size != null ? max()! > size * 0.5 : bal() != null && max()! > bal()! * 0.5)) {
    flag(fields.maxDrawdown, 0.4);
    checks.push({ id: 'max-looks-like-balance', status: 'conflict', fields: ['maxDrawdown'], message: `Max drawdown ${money(max()!)} looks like a balance, not a loss allowance. Check the value.` });
  }
  if (thr() != null && fields.drawdownThreshold!.source !== 'derived' && (size != null ? thr()! < size * 0.5 : bal() != null && thr()! < bal()! * 0.5)) {
    flag(fields.drawdownThreshold, 0.4);
    checks.push({ id: 'threshold-looks-like-amount', status: 'conflict', fields: ['drawdownThreshold'], message: `Threshold ${money(thr()!)} looks like a drawdown amount, not a balance level. Check the value.` });
  }
  if (bal() != null && thr() != null && thr()! >= bal()!) {
    checks.push({ id: 'threshold-above-balance', status: 'warning', fields: ['balance', 'drawdownThreshold'], message: 'The threshold is at or above the balance — the values may be swapped, or the account has hit its limit.' });
  }
  if (rem() != null && max() != null && rem()! > max()! + TOL) {
    flag(fields.drawdownRemaining, 0.5);
    checks.push({ id: 'remaining-above-max', status: 'warning', fields: ['drawdownRemaining', 'maxDrawdown'], message: 'Remaining drawdown is larger than the max drawdown — one of them is probably misread.' });
  }
  if (size != null && bal() != null && Math.abs(bal()! - size) > size * 0.5) {
    flag(fields.balance, 0.5);
    checks.push({ id: 'balance-vs-size', status: 'warning', fields: ['balance', 'accountSize'], message: 'The balance is far from the account size — check both values.' });
  }

  for (const f of Object.values(fields)) if (f) f.confidence = Math.round(f.confidence * 100) / 100;
  return { fields, checks };
}

export function reconcile(pages: PageExtraction[]): Extraction {
  const { fields, checks } = crossCheck(mergePages(pages));
  const sensitive = pages.flatMap((p) => p.sensitive);
  const fingerprint = sensitive.find((s) => s.fingerprint)?.fingerprint ?? null;
  return {
    fields,
    sensitive,
    pages: pages.map((p) => ({ page: p.page, quality: p.quality, ocrConfidence: p.ocrConfidence, wordCount: p.wordCount, fieldCount: Object.keys(p.fields).length })),
    checks,
    fingerprint,
  };
}
