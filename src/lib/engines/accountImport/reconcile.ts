import { checkPlausibility, type PlausibilityContext } from './plausibility';
import type { AmbiguousReading, ExtractedField, Extraction, FieldKey, FieldMap, ImportCheck, PageExtraction } from './types';
import { ALL_FIELDS, COUNT_FIELDS, FIELD_LABEL } from './types';

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
  // Counts are exact (4 trading days ≠ 5); money allows OCR rounding.
  if (typeof a === 'number' && typeof b === 'number') return (COUNT_FIELDS as FieldKey[]).includes(key) ? a === b : close(a, b);
  const x = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  // "LucidPro" and "LucidPro 50K Evaluation" describe the same program.
  return key === 'program' ? x.includes(y) || y.includes(x) : x === y;
}

/**
 * Dashboards use the same words for an AMOUNT and a BALANCE LEVEL: Lucid's
 * "MLL" card shows the current minimum balance ($24,270), other pages show
 * the Max Loss Limit as an allowance ($1,000); "Profit target" can be $1,250
 * or the $26,250 balance that passes it. No firm's loss allowance or target
 * is half the account, so a reading at or above half the balance (or account
 * size) is a level: max drawdown → drawdown threshold, profit target →
 * target balance. Readings are moved, never invented; a level that disagrees
 * with a threshold already read stays a conflict for the trader.
 */
export function resolveLevels(input: FieldMap): FieldMap {
  const fields: FieldMap = { ...input };
  const ref = num(fields.balance) ?? num(fields.accountSize) ?? num(fields.startingBalance);
  if (ref == null || ref <= 0) return fields;
  const move = (from: 'maxDrawdown' | 'profitTarget', to: 'drawdownThreshold' | 'profitTargetBalance', why: string) => {
    const f = fields[from];
    if (!f || f.source === 'user') return;
    const readings = [{ value: f.value, confidence: f.confidence, page: f.page, evidence: f.evidence }, ...(f.alternatives ?? []).map((a) => ({ ...a, evidence: `Read on screenshot ${a.page + 1}` }))];
    const isLevel = (v: number | string) => typeof v === 'number' && v >= ref * 0.5;
    const levels = readings.filter((r) => isLevel(r.value));
    if (!levels.length) return;
    const amounts = readings.filter((r) => !isLevel(r.value));
    // What stays an amount.
    if (amounts.length) {
      const [best, ...rest] = amounts;
      const kept: ExtractedField = { ...f, value: best.value, confidence: best.confidence, page: best.page, evidence: best.evidence };
      delete kept.alternatives;
      if (rest.length) kept.alternatives = rest.map((r) => ({ value: r.value, confidence: r.confidence, page: r.page }));
      fields[from] = kept;
    } else delete fields[from];
    // What becomes the level.
    for (const l of levels) {
      const cur = fields[to];
      const reading: ExtractedField = { key: to, value: l.value, confidence: l.confidence, source: f.source, evidence: `${l.evidence} — ${why}`, page: l.page };
      if (!cur) fields[to] = reading;
      else if (sameValue(to, cur.value, l.value)) fields[to] = { ...cur, confidence: Math.min(1, Math.max(cur.confidence, l.confidence) + 0.04) };
      else if (!cur.alternatives?.some((a) => sameValue(to, a.value, l.value)) && cur.source !== 'user')
        fields[to] = { ...cur, confidence: Math.min(cur.confidence, 0.6), alternatives: [...(cur.alternatives ?? []), { value: l.value, confidence: l.confidence, page: l.page }] };
    }
  };
  move('maxDrawdown', 'drawdownThreshold', 'a balance level, so read as the current minimum balance (MLL), not the loss allowance');
  move('profitTarget', 'profitTargetBalance', 'a balance level, so read as the target balance, not the target amount');
  return fields;
}

/** Values that change from day to day — never mixed across screenshots of different dates. */
const TIME_VARYING = new Set<FieldKey>(['balance', 'netPnl', 'dailyPnl', 'equity', 'unrealizedPnl', 'drawdownThreshold', 'currentDrawdown', 'drawdownRemaining', 'tradingDays', 'status', 'statementDate']);

const pageDate = (p: PageExtraction) => (typeof p.fields.statementDate?.value === 'string' ? p.fields.statementDate.value : null);
/** The newest dashboard date when the screenshots show more than one, else null. */
function latestOfMixedDates(pages: PageExtraction[]): string | null {
  const dates = [...new Set(pages.map(pageDate).filter((d): d is string => !!d))].sort();
  return dates.length > 1 ? dates[dates.length - 1] : null;
}

/**
 * Screenshot-set checks: different accounts in one import (blocks saving),
 * and different dashboard dates (balances, P&L and the floor come only from
 * the newest; older ones are not mixed in).
 */
export function screenshotChecks(pages: PageExtraction[]): ImportCheck[] {
  const checks: ImportCheck[] = [];
  // Two screenshots whose account numbers have nothing in common show different accounts
  // (one screenshot never conflicts with itself — it may show an id and a sub-account number).
  const perPage = pages.map((p) => new Set(p.sensitive.filter((s) => s.fingerprint).map((s) => s.fingerprint!))).filter((s) => s.size > 0);
  const disjoint = perPage.some((a, i) => perPage.slice(i + 1).some((b) => ![...a].some((x) => b.has(x))));
  if (disjoint)
    checks.push({ id: 'different-accounts', status: 'conflict', fields: [], message: 'These screenshots show different accounts. Import one account at a time — remove the screenshots of the other account.' });
  const latest = latestOfMixedDates(pages);
  if (latest) {
    const older = [...new Set(pages.map(pageDate).filter((d): d is string => !!d && d !== latest))].sort();
    checks.push({ id: 'different-dates', status: 'warning', fields: ['balance'], message: `Screenshots are from different dates (${[...older, latest].join(', ')}). Balance, P&L and drawdown values come only from the newest (${latest}); the older ones were not mixed in.` });
  }
  return checks;
}

/** Ambiguous readings of all screenshots, minus fields that were read clearly elsewhere. */
export function mergeAmbiguous(pages: PageExtraction[], fields: FieldMap): AmbiguousReading[] {
  return pages.flatMap((p) => p.ambiguous ?? []).filter((a) => !fields[a.key] || fields[a.key]!.source === 'derived' || a.reason.startsWith('Progress'));
}

export function mergePages(pages: PageExtraction[]): FieldMap {
  const out: FieldMap = {};
  const latest = latestOfMixedDates(pages);
  for (const key of ALL_FIELDS) {
    // Different dates: day-to-day values only from the newest screenshot(s) (undated ones stay in — a mismatch shows as a conflict).
    const usable = latest && TIME_VARYING.has(key) ? pages.filter((p) => { const d = pageDate(p); return d == null || d === latest; }) : pages;
    const all = usable.map((p) => p.fields[key]).filter((f): f is ExtractedField => !!f).sort((a, b) => b.confidence - a.confidence);
    if (!all.length) continue;
    const best = { ...all[0] };
    delete best.alternatives;
    // Every reading counts, including the alternatives one screenshot already had (two OCR passes that disagreed).
    const readings = all.flatMap((f, i) => [...(i ? [{ value: f.value, confidence: f.confidence, page: f.page }] : []), ...(f.alternatives ?? [])]);
    const others = readings.filter((r, i) => !sameValue(key, r.value, best.value) && readings.findIndex((x) => sameValue(key, x.value, r.value)) === i);
    if (others.length) {
      best.alternatives = others;
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
export function crossCheck(
  input: FieldMap,
  opts: { noDerive?: Set<FieldKey>; /** Firm sizes / the account being updated, for plausibility. */ context?: PlausibilityContext } = {},
): { fields: FieldMap; checks: ImportCheck[]; ambiguous: AmbiguousReading[] } {
  const fields: FieldMap = {};
  for (const [k, f] of Object.entries(resolveLevels(input)) as [FieldKey, ExtractedField][]) if (f && f.source !== 'derived') fields[k] = { ...f };
  const checks: ImportCheck[] = [];
  const may = (k: FieldKey) => !opts.noDerive?.has(k);

  // Implausible readings never reach the review as values (they become "needs confirmation").
  const pl = checkPlausibility(fields, opts.context);
  for (const k of Object.keys(fields) as FieldKey[]) if (!pl.fields[k]) delete fields[k];
  Object.assign(fields, pl.fields);
  checks.push(...pl.checks);

  // Lucid's progress bar labels the cushion "DRAWDOWN" / "REMAINING": a reading equal to balance − minimum
  // balance IS the remaining drawdown (filed by arithmetic, never by guess).
  const plain = (f: ExtractedField | undefined) => (f && f.source !== 'derived' && !f.alternatives?.length && typeof f.value === 'number' ? f.value : null);
  const refile = () => {
    const b = plain(fields.balance);
    const t = plain(fields.drawdownThreshold);
    if (b == null || t == null || fields.drawdownRemaining) return;
    for (const from of ['currentDrawdown', 'profitRemaining'] as const) {
      const f = fields[from];
      const v = plain(f);
      if (f && v != null && close(b - t, v) && !(from === 'profitRemaining' && plain(fields.profitTargetBalance) != null && close(plain(fields.profitTargetBalance)! - b, v))) {
        fields.drawdownRemaining = { ...f, key: 'drawdownRemaining', evidence: `${f.evidence} · equals balance − minimum balance` };
        delete fields[from];
        return;
      }
    }
  };

  // Two readings of one value (two OCR passes, two screenshots): arithmetic with values read only one way decides —
  // shown as a check, the other reading named. Without such agreement it stays a conflict for the trader.
  const sum = (a: FieldKey, b: FieldKey, sign = 1) => () => (plain(fields[a]) != null && plain(fields[b]) != null ? plain(fields[a])! + sign * plain(fields[b])! : null);
  const identities: [FieldKey, () => number | null, string][] = [
    ['balance', sum('drawdownThreshold', 'drawdownRemaining'), 'minimum balance + remaining drawdown'],
    // Lucid shows the cushion as "DRAWDOWN": minimum balance + that amount = balance settles both.
    ['balance', sum('drawdownThreshold', 'currentDrawdown'), 'minimum balance + the drawdown shown'],
    ['balance', sum('profitTargetBalance', 'profitRemaining', -1), 'target balance − profit remaining'],
    ['balance', sum('startingBalance', 'netPnl'), 'starting balance + total P&L'],
    ['drawdownThreshold', sum('balance', 'drawdownRemaining', -1), 'balance − remaining drawdown'],
    ['drawdownRemaining', sum('balance', 'drawdownThreshold', -1), 'balance − minimum balance'],
    ['profitTargetBalance', sum('balance', 'profitRemaining'), 'balance + profit remaining'],
    ['profitRemaining', sum('profitTargetBalance', 'balance', -1), 'target balance − balance'],
    ['netPnl', sum('balance', 'startingBalance', -1), 'balance − starting balance'],
  ];
  const resolve = () => {
    for (const [key, f] of Object.entries(fields) as [FieldKey, ExtractedField][]) {
      if (!f.alternatives?.length || f.source === 'user' || typeof f.value !== 'number') continue;
      const candidates = [f.value, ...f.alternatives.map((a) => a.value)].filter((v): v is number => typeof v === 'number');
      const expected = identities.filter(([k]) => k === key).map(([, calc, how]) => ({ v: calc(), how })).filter((e): e is { v: number; how: string } => e.v != null);
      const hits = candidates.filter((c) => expected.some((e) => close(e.v, c)));
      if (hits.length !== 1) continue;
      const pick = hits[0];
      const how = expected.find((e) => close(e.v, pick))!.how;
      const others = candidates.filter((c) => c !== pick);
      const alt = f.alternatives.find((a) => a.value === pick);
      const next: ExtractedField = { ...f, value: pick, confidence: Math.max(0.75, alt?.confidence ?? f.confidence), page: alt?.page ?? f.page, evidence: `${f.evidence} · ${money(pick)} agrees with ${how}` };
      delete next.alternatives;
      fields[key] = next;
      checks.push({ id: `resolved:${key}`, status: 'consistent', fields: [key], message: `${FIELD_LABEL[key]}: read as ${[pick, ...others].map(money).join(' and ')} — ${money(pick)} agrees with ${how}, so it is used. Compare with your dashboard.` });
    }
  };
  for (let round = 0; round < 3; round++) {
    refile();
    resolve();
  }
  refile();

  for (const [key, f] of Object.entries(fields) as [FieldKey, ExtractedField][]) {
    // A program title is a name for matching (its readings are all used there), not a value to pick.
    if (f.alternatives?.length && key !== 'program') {
      const fmt = (v: number | string) => (typeof v === 'number' ? money(v) : v);
      checks.push({ id: `conflict:${key}`, status: 'conflict', fields: [key], message: `Different values were read for this field: ${[f.value, ...f.alternatives.map((a) => a.value)].map(fmt).join(' vs ')}. Pick the correct one.` });
    }
  }

  // Calculated values (only from two values that were actually read — and settled: a field whose readings still
  // disagree is never a basis for another number).
  const settled = (f: ExtractedField | undefined) => (f?.alternatives?.length ? null : num(f));
  const bal = () => settled(fields.balance);
  const thr = () => settled(fields.drawdownThreshold);
  const rem = () => settled(fields.drawdownRemaining);
  const max = () => settled(fields.maxDrawdown);
  const used = () => settled(fields.currentDrawdown);
  if (may('drawdownRemaining') && rem() == null && bal() != null && thr() != null)
    fields.drawdownRemaining = derived('drawdownRemaining', bal()! - thr()!, [fields.balance!, fields.drawdownThreshold!], 'Calculated: current balance − drawdown threshold');
  if (may('drawdownRemaining') && rem() == null && max() != null && used() != null)
    fields.drawdownRemaining = derived('drawdownRemaining', max()! - used()!, [fields.maxDrawdown!, fields.currentDrawdown!], 'Calculated: max drawdown − drawdown used');
  if (may('drawdownThreshold') && thr() == null && bal() != null && rem() != null && fields.drawdownRemaining!.source !== 'derived')
    fields.drawdownThreshold = derived('drawdownThreshold', bal()! - rem()!, [fields.balance!, fields.drawdownRemaining!], 'Calculated: current balance − remaining drawdown');

  // Net P&L from a READ starting balance and balance (25,000 → 24,934 = −66). The nominal account size is never a starting balance.
  if (may('netPnl') && num(fields.netPnl) == null && bal() != null && num(fields.startingBalance) != null)
    fields.netPnl = derived('netPnl', bal()! - num(fields.startingBalance)!, [fields.balance!, fields.startingBalance!], 'Calculated: current balance − starting balance');
  // Drawdown used from a read allowance and a read remaining amount.
  if (may('currentDrawdown') && used() == null && max() != null && rem() != null && fields.drawdownRemaining!.source !== 'derived' && rem()! <= max()! + TOL && rem()! >= 0)
    fields.currentDrawdown = derived('currentDrawdown', max()! - rem()!, [fields.maxDrawdown!, fields.drawdownRemaining!], 'Calculated: max drawdown − remaining drawdown');

  // Starting balance from two read values: current balance − total P&L (marked calculated; never saved over an account's start).
  if (may('startingBalance') && fields.startingBalance == null && plain(fields.balance) != null && plain(fields.netPnl) != null)
    fields.startingBalance = derived('startingBalance', plain(fields.balance)! - plain(fields.netPnl)!, [fields.balance!, fields.netPnl!], 'Calculated: current balance − total P&L');
  // Profit still to make, from the target balance and the balance (both read).
  if (may('profitRemaining') && fields.profitRemaining == null && plain(fields.profitTargetBalance) != null && plain(fields.balance) != null)
    fields.profitRemaining = derived('profitRemaining', plain(fields.profitTargetBalance)! - plain(fields.balance)!, [fields.profitTargetBalance!, fields.balance!], 'Calculated: target balance − current balance');
  // balance + profit remaining = target balance
  {
    const b = plain(fields.balance);
    const pr = plain(fields.profitRemaining);
    const tb = plain(fields.profitTargetBalance);
    if (b != null && pr != null && tb != null) {
      if (close(b + pr, tb)) {
        [fields.balance, fields.profitRemaining, fields.profitTargetBalance].forEach((f) => boost(f));
        checks.push({ id: 'balance-remaining-target', status: 'consistent', fields: ['balance', 'profitRemaining', 'profitTargetBalance'], message: `Balance + profit remaining = target balance (${money(tb)}).` });
      } else {
        [fields.profitRemaining, fields.profitTargetBalance].forEach((f) => flag(f, 0.5));
        checks.push({ id: 'balance-remaining-target', status: 'conflict', fields: ['balance', 'profitRemaining', 'profitTargetBalance'], message: `Balance ${money(b)} + profit remaining ${money(pr)} = ${money(b + pr)}, but the target balance reads ${money(tb)}. One of them is misread — correct it.` });
      }
    }
  }

  // Profit target amount ⇄ target balance, only from a READ starting balance (never the nominal account size).
  const base = fields.startingBalance?.source === 'derived' ? null : num(fields.startingBalance);
  const baseField = fields.startingBalance;
  const tgt = num(fields.profitTarget);
  const tgtBal = num(fields.profitTargetBalance);
  if (may('profitTarget') && tgt == null && tgtBal != null && base != null && tgtBal > base)
    fields.profitTarget = derived('profitTarget', tgtBal - base, [fields.profitTargetBalance!, baseField!], 'Calculated: target balance − starting balance');
  if (may('profitTargetBalance') && tgtBal == null && tgt != null && base != null)
    fields.profitTargetBalance = derived('profitTargetBalance', base + tgt, [fields.profitTarget!, baseField!], 'Calculated: starting balance + profit target');
  if (tgt != null && tgtBal != null && base != null && fields.profitTarget!.source !== 'derived' && fields.profitTargetBalance!.source !== 'derived' && !close(base + tgt, tgtBal)) {
    flag(fields.profitTarget, 0.55);
    checks.push({ id: 'target-vs-target-balance', status: 'warning', fields: ['profitTarget', 'profitTargetBalance'], message: `Profit target ${money(tgt)} + ${money(base)} ≠ target balance ${money(tgtBal)}. Check both values.` });
  }

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
  if (max() != null && used() != null && rem() != null && fields.currentDrawdown!.source !== 'derived') {
    if (close(used()! + rem()!, max()!)) {
      [fields.maxDrawdown, fields.currentDrawdown, fields.drawdownRemaining].forEach((f) => boost(f));
      checks.push({ id: 'used-remaining-max', status: 'consistent', fields: ['maxDrawdown', 'currentDrawdown', 'drawdownRemaining'], message: `Drawdown used + remaining = max drawdown (${money(max()!)}).` });
    } else if (fields.drawdownRemaining!.source !== 'derived') {
      [fields.currentDrawdown, fields.drawdownRemaining].forEach((f) => flag(f));
      checks.push({ id: 'used-remaining-max', status: 'warning', fields: ['maxDrawdown', 'currentDrawdown', 'drawdownRemaining'], message: `Drawdown used + remaining (${money(used()! + rem()!)}) ≠ max drawdown (${money(max()!)}).` });
    }
  }
  // starting + net P&L = balance
  const start = fields.startingBalance?.source === 'derived' ? null : num(fields.startingBalance);
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
  return { fields, checks, ambiguous: pl.ambiguous };
}

export function reconcile(pages: PageExtraction[], context?: PlausibilityContext): Extraction {
  const { fields, checks: cc, ambiguous: implausible } = crossCheck(mergePages(pages), { context });
  const checks = [...screenshotChecks(pages), ...cc];
  const ambiguous = [...mergeAmbiguous(pages, fields), ...implausible];
  const sensitive = pages.flatMap((p) => p.sensitive);
  const fingerprint = sensitive.find((s) => s.fingerprint)?.fingerprint ?? null;
  return {
    fields,
    ...(ambiguous.length ? { ambiguous } : {}),
    sensitive,
    pages: pages.map((p) => ({ page: p.page, quality: p.quality, ocrConfidence: p.ocrConfidence, wordCount: p.wordCount, fieldCount: Object.keys(p.fields).length })),
    checks,
    fingerprint,
  };
}
