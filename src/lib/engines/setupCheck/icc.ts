// SHARED, dependency-free (synced to supabase/functions/_shared/setupCheck).
// ICC — Indication, Correction, Continuation: a price-action / market-structure
// continuation framework (associated with Trades By Sci; this is Prop Guard's
// rule-based interpretation, not an official version).
//
// Division of labour (same as every Setup Check):
//  - The vision model (or the trader, manually) only OBSERVES each stage:
//    higher-timeframe bias, indication, correction, continuation, levels.
//  - This module turns trusted observations into evidence for the ICC rules,
//    the ICC entry status, the 0–100 stage-quality score and the "what must
//    happen next" text — all deterministically.
//  - `evaluateSetup` alone makes the final decision, still enforcing the
//    trader's risk plan and prop-firm rules. A high ICC score never raises
//    risk and never overrides a risk / prop failure.
import type { AnalysisMode, Evidence, Input, SetupEvaluation } from './engine';
import type { SetupRule } from './rules';

export const ICC_LIBRARY_ID = 'icc';
export const ICC_NAME = 'ICC — Indication / Correction / Continuation';
/** Vision evidence below this confidence stays UNVERIFIED (same bar as the engine). */
export const ICC_MIN_CONFIDENCE = 0.8;

// ───────────────────────────── Template text (used by the Strategy Library entry) ─────────────────────────────

export const ICC_TEXT = {
  checklist: [
    'Higher timeframe supports (or does not strongly oppose) the direction',
    'Indication: candle body closed beyond a meaningful swing with displacement',
    'Correction: orderly pullback against the indication, structure intact',
    'Continuation: short-term structure reclaimed with a confirming candle close',
    'Stop beyond the correction swing (structural invalidation)',
    'Room to a structural target at or above the minimum R:R',
  ],
  entryTrigger: 'After the correction, a continuation candle closes back through short-term structure in the indication direction',
  confirmations: [
    'Indication candle body closes beyond the prior swing (not just a wick)',
    'Continuation candle closes with renewed momentum in the indication direction',
  ],
  invalidationRules: [
    'Correction breaks the structure that created the indication',
    'Higher-timeframe structure strongly opposes the trade direction',
  ],
} as const;

// ───────────────────────────── Observation model ─────────────────────────────

export type IccBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type IccIndicationStatus = 'CONFIRMED' | 'WEAK' | 'NOT_PRESENT';
export type IccCorrectionStatus = 'CONFIRMED' | 'DEVELOPING' | 'TOO_SHALLOW' | 'TOO_DEEP' | 'INVALIDATED' | 'NOT_PRESENT';
export type IccContinuationStatus = 'CONFIRMED' | 'DEVELOPING' | 'NOT_CONFIRMED' | 'FAILED';
export type IccQuality = 'STRONG' | 'MODERATE' | 'WEAK';
export type IccRoom = 'CLEAR' | 'LIMITED' | 'BLOCKED';
export type IccOverlayKey = 'indication' | 'correctionTop' | 'correctionBottom' | 'continuation' | 'entry' | 'stop' | 'tp1' | 'tp2';

/** What the chart shows (vision) — every field may be unknown (null). Never a decision or a score. */
export interface IccObservation {
  htfBias: IccBias | null;
  htfReason: string;
  indication: { status: IccIndicationStatus | null; direction: 'BULLISH' | 'BEARISH' | null; swingLevel: number | null; bodyClose: boolean | null; displacement: IccQuality | null; reason: string };
  correction: { status: IccCorrectionStatus | null; zoneLow: number | null; zoneHigh: number | null; reason: string };
  continuation: { status: IccContinuationStatus | null; level: number | null; momentum: IccQuality | null; reason: string };
  roomToTarget: IccRoom | null;
  /** Levels read from the chart's price axis (suggestions — the trader confirms them). */
  levels: { entry: number | null; stop: number | null; tp1: number | null; tp2: number | null };
  /** Approximate vertical positions on the screenshot (0 = top, 1 = bottom) for the overlay. */
  overlay: Partial<Record<IccOverlayKey, number>>;
  nextCondition: string;
  confidence: number;
}

/** The trader's explicit stage confirmations (nothing pre-selected). Direction comes from the trade side. */
export interface IccManual {
  htfBias?: IccBias;
  indication?: IccIndicationStatus;
  displacement?: IccQuality;
  correction?: IccCorrectionStatus;
  continuation?: IccContinuationStatus;
  momentum?: IccQuality;
  room?: IccRoom;
}

const BIAS: IccBias[] = ['BULLISH', 'BEARISH', 'NEUTRAL'];
const INDICATION: IccIndicationStatus[] = ['CONFIRMED', 'WEAK', 'NOT_PRESENT'];
const CORRECTION: IccCorrectionStatus[] = ['CONFIRMED', 'DEVELOPING', 'TOO_SHALLOW', 'TOO_DEEP', 'INVALIDATED', 'NOT_PRESENT'];
const CONTINUATION: IccContinuationStatus[] = ['CONFIRMED', 'DEVELOPING', 'NOT_CONFIRMED', 'FAILED'];
const QUALITY: IccQuality[] = ['STRONG', 'MODERATE', 'WEAK'];
const ROOM: IccRoom[] = ['CLEAR', 'LIMITED', 'BLOCKED'];
const OVERLAY_KEYS: IccOverlayKey[] = ['indication', 'correctionTop', 'correctionBottom', 'continuation', 'entry', 'stop', 'tp1', 'tp2'];

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const price = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e9 ? v : null);
const frac = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
const text = (v: unknown, max = 240) =>
  (typeof v === 'string' ? v : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Wording a reading may never use (it would read as a prediction or encouragement). */
const UNSUPPORTED = /guarantee|can'?t lose|cannot lose|sure thing|high[- ]probability|take this trade|buy now|sell now|winner|risk[- ]free/i;
const safe = (s: string) => (UNSUPPORTED.test(s) ? '' : s);

/** Parse an untrusted ICC observation (model output). Unknown / invalid values become null. */
export function parseIccObservation(raw: unknown): IccObservation | null {
  const o = obj(raw);
  if (!Object.keys(o).length) return null;
  const ind = obj(o.indication);
  const cor = obj(o.correction);
  const con = obj(o.continuation);
  const lv = obj(o.levels);
  const ov = obj(o.overlay);
  const overlay: Partial<Record<IccOverlayKey, number>> = {};
  for (const k of OVERLAY_KEYS) {
    const y = frac(ov[k]);
    if (y != null) overlay[k] = y;
  }
  const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? Math.min(1, Math.max(0, o.confidence)) : 0;
  const zoneA = price(cor.zoneLow);
  const zoneB = price(cor.zoneHigh);
  return {
    htfBias: pick(o.htfBias, BIAS),
    htfReason: safe(text(o.htfReason)),
    indication: { status: pick(ind.status, INDICATION), direction: pick(ind.direction, ['BULLISH', 'BEARISH'] as const), swingLevel: price(ind.swingLevel), bodyClose: typeof ind.bodyClose === 'boolean' ? ind.bodyClose : null, displacement: pick(ind.displacement, QUALITY), reason: safe(text(ind.reason)) },
    correction: { status: pick(cor.status, CORRECTION), zoneLow: zoneA != null && zoneB != null ? Math.min(zoneA, zoneB) : zoneA, zoneHigh: zoneA != null && zoneB != null ? Math.max(zoneA, zoneB) : zoneB, reason: safe(text(cor.reason)) },
    continuation: { status: pick(con.status, CONTINUATION), level: price(con.level), momentum: pick(con.momentum, QUALITY), reason: safe(text(con.reason)) },
    roomToTarget: pick(o.roomToTarget, ROOM),
    levels: { entry: price(lv.entry), stop: price(lv.stop), tp1: price(lv.tp1), tp2: price(lv.tp2) },
    overlay,
    nextCondition: safe(text(o.nextCondition, 300)),
    confidence,
  };
}

/** Parse the trader's stage confirmations from an untrusted client payload. */
export function parseIccManual(raw: unknown): IccManual {
  const o = obj(raw);
  const out: IccManual = {};
  const htf = pick(o.htfBias, BIAS);
  if (htf) out.htfBias = htf;
  const i = pick(o.indication, INDICATION);
  if (i) out.indication = i;
  const d = pick(o.displacement, QUALITY);
  if (d) out.displacement = d;
  const c = pick(o.correction, CORRECTION);
  if (c) out.correction = c;
  const n = pick(o.continuation, CONTINUATION);
  if (n) out.continuation = n;
  const m = pick(o.momentum, QUALITY);
  if (m) out.momentum = m;
  const r = pick(o.room, ROOM);
  if (r) out.room = r;
  return out;
}

// ───────────────────────────── Rules ─────────────────────────────

export type IccStrategyFields = { libraryId?: string | null; checklist: { label: string }[]; entryTrigger: string; confirmationRules: string; invalidationRules: string; biasRequirement: string; requiresBiasAlignment: boolean };

export const isIccStrategy = (s: { libraryId?: string | null }) => s.libraryId === ICC_LIBRARY_ID;

/**
 * The ICC rules, listed FIRST when ICC is selected. Stage rules (kind 'icc')
 * get their evidence from the ICC stage observations; the structural stop is
 * checked against the correction zone when it is known, otherwise the trader
 * confirms it like any other chart rule.
 */
export function iccRules(): SetupRule[] {
  const r = (id: string, label: string, description: string, critical: boolean, kind: SetupRule['kind'] = 'icc'): SetupRule => ({ id, label, description, required: true, critical, kind });
  return [
    r('icc_htf', 'Higher timeframe does not oppose', 'Daily / 4H / 1H structure supports, or at least does not strongly oppose, the trade direction.', true),
    r('icc_indication', '1 — Indication confirmed', 'A meaningful prior swing is broken with a candle BODY close beyond it and clear displacement.', false),
    r('icc_correction', '2 — Correction in place', 'Price has pulled back against the indication in an orderly way — not random chop — and the structure is intact.', false),
    r('icc_continuation', '3 — Continuation confirmed', 'Price reclaims / breaks short-term structure back in the indication direction with a confirming candle close.', false),
    r('icc_structure_intact', 'Not invalidated: indication structure intact', 'MUST NOT be present: the correction breaking the structure that created the indication, or a failed continuation.', true),
    r('icc_direction_match', 'Trade direction matches the indication', 'Longs only after a bullish indication; shorts only after a bearish indication.', true),
    r('icc_stop_structural', 'Stop beyond the correction swing', 'Bullish: stop below the correction swing low. Bearish: stop above the correction swing high.', false, 'visual'),
    r('icc_quality', 'ICC stage quality ≥ 70', 'All three stages are confirmed and the stage-quality score is at least 70/100 (acceptable).', false),
    r('icc_quality_floor', 'ICC stage quality ≥ 60', 'A complete pattern scoring below 60/100 is below standard — stand down.', true),
  ];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Saved-strategy fields that only repeat the ICC template (already covered by the ICC rules). */
export function iccTemplateDuplicates(s: IccStrategyFields) {
  return {
    checklistLabel: (label: string) => ICC_TEXT.checklist.some((c) => same(c, label)),
    entryTrigger: same(s.entryTrigger, ICC_TEXT.entryTrigger),
    confirmationRules: same(s.confirmationRules, ICC_TEXT.confirmations.join('; ')),
    invalidationRules: same(s.invalidationRules, ICC_TEXT.invalidationRules.join('; ')),
    bias: true, // the ICC higher-timeframe rule replaces the generic bias rule
  };
}

// ───────────────────────────── Trusted stages ─────────────────────────────

export type StageSource = 'vision' | 'manual';
type Staged<T> = { value: T; source: StageSource; reason: string } | null;

export interface IccStages {
  direction: { value: 'BULLISH' | 'BEARISH'; source: StageSource } | null;
  htf: Staged<IccBias>;
  indication: Staged<IccIndicationStatus>;
  displacement: IccQuality | null;
  correction: Staged<IccCorrectionStatus>;
  continuation: Staged<IccContinuationStatus>;
  momentum: IccQuality | null;
  room: IccRoom | null;
  /** Correction zone from trusted chart analysis (for the structural stop check). */
  zone: { low: number | null; high: number | null } | null;
}

const MANUAL_REASON = 'Confirmed by you.';

/**
 * Per stage: the trader's explicit confirmation wins; otherwise REAL chart
 * analysis at ≥ 0.8 confidence; otherwise the stage is unknown. Demo
 * observations are never used here (they are shown, never counted).
 */
export function resolveIccStages(observation: IccObservation | null, observationMode: AnalysisMode, manual: IccManual, side: 'LONG' | 'SHORT' | null): IccStages {
  const v = observation && observationMode === 'REAL' && observation.confidence >= ICC_MIN_CONFIDENCE ? observation : null;
  const fromManual = <T>(value: T | undefined): Staged<T> => (value ? { value, source: 'manual', reason: MANUAL_REASON } : null);
  const fromVision = <T>(value: T | null | undefined, reason: string): Staged<T> => (v && value ? { value, source: 'vision', reason: reason || 'Read from the chart.' } : null);
  const sideDir: 'BULLISH' | 'BEARISH' | null = side === 'LONG' ? 'BULLISH' : side === 'SHORT' ? 'BEARISH' : null;
  // Direction: the chart's indication direction, unless the trader confirmed the stages themselves (then their own side).
  const direction = v?.indication.direction && !manual.indication ? { value: v.indication.direction, source: 'vision' as const } : sideDir ? { value: sideDir, source: 'manual' as const } : null;
  return {
    direction,
    htf: fromManual(manual.htfBias) ?? fromVision(v?.htfBias, v?.htfReason ?? ''),
    indication: fromManual(manual.indication) ?? fromVision(v?.indication.status, v?.indication.reason ?? ''),
    displacement: manual.indication ? (manual.displacement ?? null) : (v?.indication.displacement ?? null),
    correction: fromManual(manual.correction) ?? fromVision(v?.correction.status, v?.correction.reason ?? ''),
    continuation: fromManual(manual.continuation) ?? fromVision(v?.continuation.status, v?.continuation.reason ?? ''),
    momentum: manual.continuation ? (manual.momentum ?? null) : (v?.continuation.momentum ?? null),
    room: manual.room ?? v?.roomToTarget ?? null,
    zone: v && (v.correction.zoneLow != null || v.correction.zoneHigh != null) ? { low: v.correction.zoneLow, high: v.correction.zoneHigh } : null,
  };
}

// ───────────────────────────── Entry status + quality score ─────────────────────────────

export type IccEntryStatus =
  | 'WAIT — INDICATION ONLY'
  | 'WAIT — CORRECTION DEVELOPING'
  | 'WAIT — CONTINUATION NOT CONFIRMED'
  | 'VALID ICC LONG'
  | 'VALID ICC SHORT'
  | 'ICC SETUP INVALIDATED'
  | 'NO CLEAR ICC SETUP';
export type IccRiskStatus = 'VALID SETUP — POSITION SIZE TOO LARGE' | 'VALID SETUP — STOP DISTANCE EXCEEDS RISK LIMIT';

const opposes = (htf: IccBias | undefined, dir: 'BULLISH' | 'BEARISH' | undefined) => !!htf && !!dir && htf !== 'NEUTRAL' && htf !== dir;

/** Exactly one status, from what has been confirmed — never assumes a stage that isn't. */
export function iccEntryStatus(s: IccStages): { status: IccEntryStatus; reason: string } {
  const dir = s.direction?.value;
  const ind = s.indication?.value;
  if (!ind || ind === 'NOT_PRESENT' || !dir) return { status: 'NO CLEAR ICC SETUP', reason: !ind ? 'No confirmed indication yet — the structural break has not been established.' : ind === 'NOT_PRESENT' ? 'No meaningful swing has been broken.' : 'Direction of the indication is unknown.' };
  if (s.correction?.value === 'INVALIDATED' || s.continuation?.value === 'FAILED')
    return { status: 'ICC SETUP INVALIDATED', reason: s.correction?.value === 'INVALIDATED' ? 'The correction broke the structure that created the indication.' : 'The continuation attempt failed.' };
  if (opposes(s.htf?.value, dir)) return { status: 'NO CLEAR ICC SETUP', reason: `Higher-timeframe structure is ${s.htf!.value.toLowerCase()} — it strongly opposes a ${dir.toLowerCase()} ICC.` };
  const cor = s.correction?.value;
  if (!cor || cor === 'NOT_PRESENT') return { status: 'WAIT — INDICATION ONLY', reason: 'Indication only — no correction yet. Do not enter during the indication.' };
  if (cor === 'DEVELOPING' || cor === 'TOO_SHALLOW') return { status: 'WAIT — CORRECTION DEVELOPING', reason: cor === 'TOO_SHALLOW' ? 'The pullback is too shallow to count as a correction yet.' : 'The correction is still developing — a retrace alone is not an entry.' };
  if (s.continuation?.value !== 'CONFIRMED') return { status: 'WAIT — CONTINUATION NOT CONFIRMED', reason: s.continuation?.value === 'DEVELOPING' ? 'Continuation is developing but not confirmed by a candle close.' : 'Continuation has not been confirmed.' };
  return { status: dir === 'BULLISH' ? 'VALID ICC LONG' : 'VALID ICC SHORT', reason: 'Indication, correction and continuation are all confirmed.' };
}

export interface IccScore {
  total: number;
  parts: { id: 'htf' | 'indication' | 'correction' | 'continuation' | 'riskReward'; label: string; points: number; max: number; note: string }[];
}

const priceRR = (side: 'LONG' | 'SHORT' | null, entry: number | null, stop: number | null, target: number | null) => {
  if (!side || !entry || !stop || !target) return null;
  const risk = side === 'LONG' ? entry - stop : stop - entry;
  const reward = side === 'LONG' ? target - entry : entry - target;
  return risk > 0 && reward > 0 ? reward / risk : null;
};

/**
 * Stage QUALITY, 0–100 (HTF 20 · indication 20 · correction 20 · continuation 25 · R:R + room 15).
 * Only trusted stages count — an unknown stage scores zero. It measures how
 * well the ICC structure is formed, not a win probability.
 */
export function iccScore(s: IccStages, trade: { side: 'LONG' | 'SHORT' | null; entry: number | null; stop: number | null; target: number | null }, minRR: number | null): IccScore {
  const dir = s.direction?.value;
  const htf = s.htf?.value;
  const htfPts = !htf || !dir ? 0 : htf === dir ? 20 : htf === 'NEUTRAL' ? 10 : 0;
  const q = (x: IccQuality | null, strong: number, moderate: number) => (x === 'STRONG' ? strong : x === 'MODERATE' ? moderate : 0);
  const ind = s.indication?.value;
  const indPts = ind === 'CONFIRMED' ? 16 + q(s.displacement, 4, 2) : ind === 'WEAK' ? 8 : 0;
  const cor = s.correction?.value;
  const corPts = cor === 'CONFIRMED' ? 20 : cor === 'TOO_DEEP' || cor === 'DEVELOPING' ? 8 : cor === 'TOO_SHALLOW' ? 5 : 0;
  const con = s.continuation?.value;
  const conPts = con === 'CONFIRMED' ? 19 + q(s.momentum, 6, 3) : con === 'DEVELOPING' ? 8 : con === 'NOT_CONFIRMED' ? 3 : 0;
  const rr = priceRR(trade.side, trade.entry, trade.stop, trade.target);
  const need = minRR && minRR > 0 ? minRR : 2;
  const rrPts = (rr == null ? 0 : rr >= need ? 10 : rr >= 1 ? 4 : 0) + (s.room === 'CLEAR' ? 5 : s.room === 'LIMITED' ? 2 : 0);
  const label = (v: string | undefined | null) => (v ? v.replace(/_/g, ' ').toLowerCase() : 'not confirmed');
  const parts: IccScore['parts'] = [
    { id: 'htf', label: 'Higher-timeframe alignment', points: htfPts, max: 20, note: !htf ? 'not confirmed' : htf === 'NEUTRAL' ? 'neutral — does not oppose' : htf === dir ? 'aligned' : 'opposes' },
    { id: 'indication', label: 'Indication quality', points: indPts, max: 20, note: `${label(ind)}${s.displacement ? ` · ${s.displacement.toLowerCase()} displacement` : ''}` },
    { id: 'correction', label: 'Correction quality', points: corPts, max: 20, note: label(cor) },
    { id: 'continuation', label: 'Continuation confirmation', points: conPts, max: 25, note: `${label(con)}${s.momentum ? ` · ${s.momentum.toLowerCase()} momentum` : ''}` },
    { id: 'riskReward', label: 'Risk/reward + nearby structure', points: rrPts, max: 15, note: `${rr == null ? 'R:R needs entry, stop, TP1 and direction' : `${rr.toFixed(2)}R to TP1 (minimum ${need})`} · room ${s.room ? s.room.toLowerCase() : 'not confirmed'}` },
  ];
  return { total: parts.reduce((n, p) => n + p.points, 0), parts };
}

export const ICC_BANDS = [
  { min: 90, label: 'A+ ICC setup' },
  { min: 80, label: 'Strong' },
  { min: 70, label: 'Acceptable but imperfect' },
  { min: 60, label: 'Weak / wait' },
  { min: 0, label: 'Below standard — stand down' },
] as const;

/** Band label. A top band is only shown when the setup is actually cleared — never while blocked. */
export function iccScoreLabel(score: number, cleared: boolean): string {
  const band = ICC_BANDS.find((b) => score >= b.min)!.label;
  return score >= 70 && !cleared ? 'Not cleared — see blockers' : band;
}

// ───────────────────────────── Evidence for the ICC rules ─────────────────────────────

const ev = (ruleId: string, status: Evidence['status'], source: StageSource, reason: string): Evidence => ({ ruleId, status, source, confidence: status === 'UNVERIFIED' ? 0 : 1, reason });

/**
 * Evidence for the ICC rules from trusted stages. Vision-derived evidence is
 * only produced from REAL, confident analysis (see resolveIccStages); the
 * engine applies its own source / confidence checks on top.
 */
export function iccEvidence(s: IccStages, trade: { side: 'LONG' | 'SHORT' | null; entry: number | null; stop: number | null; target: number | null }, minRR: number | null): Evidence[] {
  const out: Evidence[] = [];
  const dir = s.direction?.value;
  if (s.htf) out.push(ev('icc_htf', opposes(s.htf.value, dir) ? 'FAIL' : dir ? 'PASS' : 'UNVERIFIED', s.htf.source, opposes(s.htf.value, dir) ? `Higher timeframe is ${s.htf.value.toLowerCase()} — strongly opposes the ${dir!.toLowerCase()} direction. ${s.htf.reason}` : s.htf.value === 'NEUTRAL' ? `Higher timeframe neutral — does not oppose. ${s.htf.reason}` : dir ? `Higher timeframe ${s.htf.value.toLowerCase()} — aligned. ${s.htf.reason}` : 'Direction unknown.'));
  if (s.indication) out.push(ev('icc_indication', s.indication.value === 'CONFIRMED' ? 'PASS' : 'FAIL', s.indication.source, s.indication.value === 'CONFIRMED' ? `Indication confirmed. ${s.indication.reason}` : s.indication.value === 'WEAK' ? `Indication weak (wick-only or little displacement). ${s.indication.reason}` : `No indication. ${s.indication.reason}`));
  if (s.correction) out.push(ev('icc_correction', s.correction.value === 'CONFIRMED' || s.correction.value === 'TOO_DEEP' ? 'PASS' : 'FAIL', s.correction.source, `Correction ${s.correction.value.replace(/_/g, ' ').toLowerCase()}. ${s.correction.reason}`));
  if (s.continuation) out.push(ev('icc_continuation', s.continuation.value === 'CONFIRMED' ? 'PASS' : 'FAIL', s.continuation.source, `Continuation ${s.continuation.value.replace(/_/g, ' ').toLowerCase()}. ${s.continuation.reason}`));
  const broken = s.correction?.value === 'INVALIDATED' ? s.correction : s.continuation?.value === 'FAILED' ? s.continuation : null;
  if (broken) out.push(ev('icc_structure_intact', 'FAIL', broken.source, broken === s.correction ? 'The correction broke the structure that created the indication.' : 'The continuation failed — the setup is invalidated.'));
  else if (s.indication && s.indication.value !== 'NOT_PRESENT' && (s.correction || s.continuation)) out.push(ev('icc_structure_intact', 'PASS', (s.correction ?? s.continuation)!.source, 'Indication structure remains intact.'));
  if (s.direction && trade.side && s.indication) {
    const want = trade.side === 'LONG' ? 'BULLISH' : 'BEARISH';
    out.push(ev('icc_direction_match', s.direction.value === want ? 'PASS' : 'FAIL', s.direction.source, s.direction.value === want ? `${trade.side === 'LONG' ? 'Long' : 'Short'} after a ${want.toLowerCase()} indication.` : `A ${trade.side.toLowerCase()} trade against a ${s.direction.value.toLowerCase()} indication.`));
  }
  if (s.zone && trade.side && trade.stop) {
    const ok = trade.side === 'LONG' ? s.zone.low != null && trade.stop < s.zone.low : s.zone.high != null && trade.stop > s.zone.high;
    const edge = trade.side === 'LONG' ? s.zone.low : s.zone.high;
    if (edge != null) out.push(ev('icc_stop_structural', ok ? 'PASS' : 'FAIL', 'vision', ok ? `Stop ${trade.stop} is beyond the correction ${trade.side === 'LONG' ? 'low' : 'high'} (~${edge}).` : `Stop ${trade.stop} is inside the correction — the structural invalidation is ~${edge}.`));
  }
  const { status } = iccEntryStatus(s);
  if (status === 'VALID ICC LONG' || status === 'VALID ICC SHORT') {
    const score = iccScore(s, trade, minRR).total;
    const src = s.continuation!.source;
    out.push(ev('icc_quality', score >= 70 ? 'PASS' : 'FAIL', src, `ICC stage quality ${score}/100${score >= 70 ? '' : ' — below 70, wait for a cleaner setup'}.`));
    out.push(ev('icc_quality_floor', score >= 60 ? 'PASS' : 'FAIL', src, `ICC stage quality ${score}/100${score >= 60 ? '' : ' — below 60, stand down on this pattern'}.`));
  }
  return out;
}

// ───────────────────────────── Summary (the ICC SETUP card) ─────────────────────────────

export interface IccSummary {
  direction: IccBias;
  htf: { value: IccBias | null; source: StageSource | null; reason: string };
  indication: { value: IccIndicationStatus | null; source: StageSource | null; reason: string };
  correction: { value: IccCorrectionStatus | null; source: StageSource | null; reason: string };
  continuation: { value: IccContinuationStatus | null; source: StageSource | null; reason: string };
  entryStatus: IccEntryStatus | IccRiskStatus;
  patternStatus: IccEntryStatus;
  statusReason: string;
  score: IccScore;
  scoreLabel: string;
  levels: { entry: number | null; stop: number | null; tp1: number | null; tp2: number | null };
  rr: { tp1: number | null; tp2: number | null };
  /** Levels read from the chart (suggestions, never applied automatically). */
  chartLevels: IccObservation['levels'] | null;
  happened: string[];
  developing: string[];
  needed: string[];
  why: string[];
  next: string;
  /** Chart-reading suggestion for what must happen next (REAL analysis only). */
  chartNext: string | null;
  /** Observation shown for illustration / overlay; `counted` is false for demo or low-confidence readings. */
  observation: { data: IccObservation; source: 'vision' | 'demo'; counted: boolean } | null;
}

const tfWord = (tf: string | null) => {
  const m = tf ? /(\d+)\s*([mhd])/i.exec(tf) : null;
  if (!m) return 'entry-timeframe';
  return `${m[1]}-${m[2].toLowerCase() === 'm' ? 'minute' : m[2].toLowerCase() === 'h' ? 'hour' : 'day'}`;
};

const fmt = (n: number | null | undefined) => (n == null ? null : Number(n.toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 }));

/** Risk statuses for a VALID pattern whose stop / size breaks the trader's risk plan or the account limits. */
function riskStatus(input: Input, evaluation: SetupEvaluation): { status: IccRiskStatus; detail: string } | null {
  const t = input.trade;
  const failed = (id: string, list: { id: string; status: string }[]) => list.some((c) => c.id === id && c.status === 'FAIL');
  const budget = failed('budget', evaluation.riskChecks);
  const buffers = failed('buffers', evaluation.propChecks);
  const contracts = failed('contracts', evaluation.propChecks);
  if (!budget && !buffers && !contracts) return null;
  if (!t.entry || !t.stop || !t.pointValue || !t.quantity) return { status: 'VALID SETUP — POSITION SIZE TOO LARGE', detail: 'The position breaks a risk or account limit.' };
  const perContract = Math.abs(t.entry - t.stop) * t.pointValue;
  const costs = (t.costs ?? 0) + (t.slippage ?? 0);
  const p = input.prop;
  const limits = [t.maxRisk, p.mode === 'prop' && p.drawdownBuffer != null ? p.drawdownBuffer - (p.reserve ?? 0) : undefined, p.mode === 'prop' && p.dailyLossRemaining != null ? p.dailyLossRemaining - (p.reserve ?? 0) : undefined].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const limit = limits.length ? Math.min(...limits) : null;
  if (limit != null && perContract + costs > limit)
    return { status: 'VALID SETUP — STOP DISTANCE EXCEEDS RISK LIMIT', detail: `Even 1 contract risks about $${(perContract + costs).toFixed(2)} to the structural stop — over your $${limit.toFixed(2)} limit. Wait for a tighter structural entry or pass.` };
  const fit = limit != null ? Math.floor((limit - costs) / perContract) : null;
  const cap = p.mode === 'prop' && p.maxContracts ? p.maxContracts : null;
  const max = fit != null && cap != null ? Math.min(fit, cap) : (fit ?? cap);
  return { status: 'VALID SETUP — POSITION SIZE TOO LARGE', detail: max != null && max >= 1 ? `Reduce to at most ${max} contract${max === 1 ? '' : 's'} — never widen risk because the setup looks good.` : 'Reduce the position size to fit your limits.' };
}

export function iccSummary(args: {
  stages: IccStages;
  observation: { data: IccObservation; source: 'vision' | 'demo'; mode: AnalysisMode } | null;
  trade: { side: 'LONG' | 'SHORT' | null; entry: number | null; stop: number | null; target: number | null; target2: number | null };
  minRR: number | null;
  timeframe: string | null;
  input: Input;
  evaluation: SetupEvaluation;
}): IccSummary {
  const { stages: s, trade, evaluation } = args;
  const pattern = iccEntryStatus(s);
  const score = iccScore(s, trade, args.minRR);
  const cleared = evaluation.decision === 'TAKE TRADE';
  const valid = pattern.status === 'VALID ICC LONG' || pattern.status === 'VALID ICC SHORT';
  const risk = valid ? riskStatus(args.input, evaluation) : null;
  const dir = s.direction?.value;
  const up = dir !== 'BEARISH';
  const tf = tfWord(args.timeframe);
  const obs = args.observation;
  const counted = !!obs && obs.source === 'vision' && obs.mode === 'REAL' && obs.data.confidence >= ICC_MIN_CONFIDENCE;

  const happened: string[] = [];
  const developing: string[] = [];
  const needed: string[] = [];
  const word = (v: string) => v.replace(/_/g, ' ').toLowerCase();
  if (s.indication?.value === 'CONFIRMED') happened.push(`Indication: ${dir ? `${dir.toLowerCase()} ` : ''}structural break confirmed.`);
  else if (s.indication?.value === 'WEAK') developing.push('Indication: weak — break without a convincing body close / displacement.');
  else needed.push('Indication: a candle body close beyond a meaningful swing, with displacement.');
  const cor = s.correction?.value;
  if (cor === 'CONFIRMED' || cor === 'TOO_DEEP') happened.push(`Correction: ${cor === 'TOO_DEEP' ? 'deep pullback (structure still intact)' : 'orderly pullback in place'}.`);
  else if (cor === 'INVALIDATED') happened.push('Correction: broke the indication structure — setup invalidated.');
  else if (cor === 'DEVELOPING' || cor === 'TOO_SHALLOW') developing.push(`Correction: ${word(cor)}.`);
  else needed.push(`Correction: a pullback against the ${up ? 'bullish' : 'bearish'} move.`);
  const con = s.continuation?.value;
  if (con === 'CONFIRMED') happened.push('Continuation: confirmed by a candle close.');
  else if (con === 'FAILED') happened.push('Continuation: failed.');
  else if (con === 'DEVELOPING') developing.push('Continuation: developing — not confirmed by a close yet.');
  else needed.push(`Continuation: a ${tf} candle close back through short-term structure ${up ? 'upward' : 'downward'}.`);

  const lv = obs?.data.levels ?? null;
  const corEdge = up ? (s.zone?.high ?? null) : (s.zone?.low ?? null);
  const contLevel = (counted ? obs?.data.continuation.level : null) ?? corEdge;
  let next: string;
  switch (pattern.status) {
    case 'NO CLEAR ICC SETUP':
      next = opposes(s.htf?.value, dir) ? `Stand aside until the higher timeframe stops opposing a ${dir!.toLowerCase()} move, or a ${up ? 'bearish' : 'bullish'} ICC forms with it.` : 'Wait for a candle body close beyond a meaningful prior swing (above a swing high for longs, below a swing low for shorts) with clear displacement.';
      break;
    case 'WAIT — INDICATION ONLY':
      next = `Do not enter on the indication. Wait for price to pull back against the ${up ? 'bullish' : 'bearish'} move while holding the structure that created it.`;
      break;
    case 'WAIT — CORRECTION DEVELOPING':
      next = `Let the correction finish: wait for price to stop making ${up ? 'lower lows' : 'higher highs'}${s.zone ? ` around ${fmt(up ? s.zone.low : s.zone.high)}` : ''}, then for a ${tf} close back ${up ? 'above' : 'below'} short-term structure.`;
      break;
    case 'WAIT — CONTINUATION NOT CONFIRMED':
      next = `Wait for a ${tf} candle close ${up ? 'above' : 'below'} ${contLevel != null ? fmt(contLevel) : `the correction ${up ? 'high' : 'low'}`} with renewed momentum before considering the ${up ? 'bullish' : 'bearish'} continuation confirmed.`;
      break;
    case 'ICC SETUP INVALIDATED':
      next = 'Stand aside — the structure behind the indication is broken. A new indication is needed before ICC applies again.';
      break;
    default:
      next = risk ? risk.detail : cleared ? `Stop stays beyond the correction ${up ? 'low' : 'high'}${trade.stop ? ` (${fmt(trade.stop)})` : ''}; position size stays within your plan.` : `Resolve: ${evaluation.blockers[0]?.label ?? 'the remaining checks'} — ${evaluation.blockers[0]?.reason ?? ''}`.trim();
  }

  const why: string[] = [];
  const critical = evaluation.evaluatedRules.filter((r) => r.critical && r.status === 'FAIL');
  for (const r of critical) why.push(r.reason);
  why.push(pattern.reason);
  if (risk) why.push(risk.detail);
  if (evaluation.riskCheck === 'FAIL') why.push(evaluation.riskChecks.find((c) => c.status === 'FAIL')!.reason);
  if (evaluation.propFirmCompliance === 'FAIL') why.push(evaluation.propChecks.find((c) => c.status === 'FAIL')!.reason);
  if (valid) why.push(`ICC stage quality ${score.total}/100.`);
  if (!cleared && evaluation.blockers.length && why.length < 3) why.push(`${evaluation.blockers.length} check${evaluation.blockers.length === 1 ? '' : 's'} still open — ${evaluation.blockers[0].label}.`);

  const entry = trade.entry;
  return {
    direction: dir ?? 'NEUTRAL',
    htf: { value: s.htf?.value ?? null, source: s.htf?.source ?? null, reason: s.htf?.reason ?? 'Not confirmed.' },
    indication: { value: s.indication?.value ?? null, source: s.indication?.source ?? null, reason: s.indication?.reason ?? 'Not confirmed.' },
    correction: { value: s.correction?.value ?? null, source: s.correction?.source ?? null, reason: s.correction?.reason ?? 'Not confirmed.' },
    continuation: { value: s.continuation?.value ?? null, source: s.continuation?.source ?? null, reason: s.continuation?.reason ?? 'Not confirmed.' },
    entryStatus: risk ? risk.status : pattern.status,
    patternStatus: pattern.status,
    statusReason: risk ? risk.detail : pattern.reason,
    score,
    scoreLabel: iccScoreLabel(score.total, cleared),
    levels: { entry, stop: trade.stop, tp1: trade.target, tp2: trade.target2 },
    rr: { tp1: priceRR(trade.side, entry, trade.stop, trade.target), tp2: priceRR(trade.side, entry, trade.stop, trade.target2) },
    chartLevels: lv && Object.values(lv).some((x) => x != null) ? lv : null,
    happened,
    developing,
    needed,
    why: [...new Set(why.filter(Boolean))].slice(0, 3),
    next,
    chartNext: counted && obs!.data.nextCondition ? obs!.data.nextCondition : null,
    observation: obs ? { data: obs.data, source: obs.source, counted } : null,
  };
}
