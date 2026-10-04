import { getInstrument, roundToTick } from '../instrumentEngine';
import { RTH_CLOSE, RTH_OPEN } from '../marketTime';
import { breakoutStrength, setupFeatures } from '../strategyEvaluators';
import type { EvaluationInput, OhlcvBar, SetupLevel, SetupSignal, StrategyEvaluator } from '../strategyEvaluators/types';
import type { ConfidenceLabel, RuleProvenance, RuleSection, StrategyRule } from './types';

/**
 * STAGE 6 — testable ruleset.
 *
 * Plain-language rules become IF/THEN conditions. Where a rule maps to an
 * objective primitive (a close beyond a level, a sweep, a body %, a volume
 * multiple…) it is evaluated automatically on candles; anything else stays in
 * the trader's words and is marked "confirm visually". The ruleset compiles to
 * a StrategyEvaluator, so Practice Mode, simulated scenarios and (later)
 * verified historical data all run the trader's OWN rules through the shared
 * no-lookahead scanner.
 */

// ───────────────────────────── DSL ─────────────────────────────

export type LevelRef =
  | { kind: 'pdh' | 'pdl' | 'vwap' | 'swing_high' | 'swing_low' | 'range_high' | 'range_low' | 'range_mid' }
  | { kind: 'orh' | 'orl'; minutes: number }
  | { kind: 'ema'; period: number; maType: 'EMA' | 'SMA' }
  /** Direction-resolved edge: breakout → long uses the high; fade → long uses the low. */
  | { kind: 'edge'; of: 'or' | 'pd' | 'range'; mode: 'breakout' | 'fade'; minutes?: number };

export type Primitive =
  | { type: 'close_beyond'; level: LevelRef; side: 'trade_dir' | 'against_dir' | 'above' | 'below' }
  | { type: 'sweep'; level: LevelRef }
  | { type: 'retest_hold'; level: LevelRef }
  | { type: 'touch'; level: LevelRef }
  | { type: 'level_available'; level: LevelRef }
  | { type: 'body_pct'; min: number }
  | { type: 'close_location'; pct: number }
  | { type: 'volume_vs_avg'; bars: number; mult: number }
  | { type: 'range_vs_avg'; bars: number; mult: number }
  | { type: 'stretched'; level: LevelRef; ranges: number }
  | { type: 'vwap_band'; sd: number }
  | { type: 'trend_structure'; swings: number }
  | { type: 'ma_side'; period: number; maType: 'EMA' | 'SMA' }
  | { type: 'shrinking_bodies'; count: number }
  | { type: 'rsi_divergence'; period: number; lookback: number }
  | { type: 'prior_move'; ranges: number }
  | { type: 'directional_candles'; count: number }
  /** The signal candle closes in the trade direction (green for longs, red for shorts). */
  | { type: 'candle_dir' }
  /** Price gave back more than pct% of the move of the last N candles. */
  | { type: 'retrace_pct'; pct: number; bars: number }
  /** Price pulled back against the trade within the last few candles and the current candle resumes the move. */
  | { type: 'pullback_resume'; bars: number }
  /** Every part must hold (compound rules such as "closes in the top 25% with volume above average"). */
  | { type: 'all'; of: Primitive[] };

export type ConditionRole = 'context' | 'bias' | 'setup' | 'entry' | 'confirmation' | 'volume' | 'volatility' | 'invalidation' | 'noTrade';

export interface RuleCondition {
  id: string;
  role: ConditionRole;
  text: string;
  source: RuleProvenance;
  confidence: ConfidenceLabel;
  primitive: Primitive | null;
  /** True when Practice can check it on candles automatically. */
  evaluable: boolean;
  /** Direction-specific rules ("selling the top" is the short side only); undefined = both. */
  appliesTo?: 'long' | 'short';
}

export interface StopSpec {
  text: string;
  kind: 'fixed_points' | 'beyond_level' | 'beyond_swing' | 'beyond_signal_bar' | 'unspecified';
  points?: number;
  level?: LevelRef;
  source: RuleProvenance | 'practice_default';
}

export interface TargetSpec {
  text: string;
  kind: 'r_multiple' | 'level' | 'points' | 'unspecified';
  r?: number;
  points?: number;
  level?: LevelRef;
  source: RuleProvenance | 'practice_default';
}

export interface IfThenLine {
  text: string;
  evaluable: boolean;
  source: RuleProvenance;
}

export interface IfThenBlock {
  kind: 'setup' | 'entry' | 'invalidation' | 'exit' | 'noTrade';
  if: IfThenLine[];
  then: string;
}

export interface TestableRuleSet {
  version: 1;
  strategyName: string;
  direction: 'long' | 'short' | 'both';
  instrument: string[];
  timeframe: string | null;
  window: { start: string; end: string } | null;
  primaryLevel: LevelRef | null;
  /** Definitions of the trader's terms and plan descriptions (not conditions). */
  definitions: string[];
  conditions: RuleCondition[];
  stop: StopSpec;
  target: TargetSpec;
  maxTrades: number | null;
  blocks: IfThenBlock[];
  coverage: { evaluable: number; total: number; testable: boolean };
  /** Values Practice uses because the plan does not state them (always shown to the trader). */
  practiceDefaults: string[];
}

// ───────────────────────────── Text → primitives ─────────────────────────────

export interface RuleSetInput {
  name: string;
  originalText: string;
  direction: 'long' | 'short' | 'both' | null;
  instrument: string[];
  timeframes: string[];
  window: { start: string | null; end: string | null };
  conceptIds: string[];
  orbMinutes: number | null;
  emaPeriod: number | null;
  emaType: string | null;
  level: string | null;
  stopPoints: number | null;
  minRR: number | null;
  maxTrades: number | null;
  /** Final rules (trader + inferred + accepted suggestions; replaced vague originals removed). */
  rules: StrategyRule[];
}

const FADE_IDS = ['liquidity_sweep', 'mean_reversion', 'range', 'reversal', 'support_resistance', 'absorption', 'order_flow', 'indicator'];

function primaryLevelOf(r: RuleSetInput): LevelRef | null {
  const ids = new Set(r.conceptIds);
  const fade = r.conceptIds.some((id) => FADE_IDS.includes(id)) && !ids.has('orb') && !ids.has('breakout');
  if (ids.has('orb')) return { kind: 'edge', of: 'or', mode: 'breakout', minutes: r.orbMinutes ?? 15 };
  const lvl = r.level?.toLowerCase() ?? '';
  if (/previous day's low/.test(lvl)) return { kind: 'pdl' };
  if (/previous day's high/.test(lvl)) return { kind: 'pdh' };
  if (ids.has('pdh_pdl')) return { kind: 'edge', of: 'pd', mode: fade ? 'fade' : 'breakout' };
  if (ids.has('moving_average') && r.emaPeriod) return { kind: 'ema', period: r.emaPeriod, maType: r.emaType === 'SMA' ? 'SMA' : 'EMA' };
  if (ids.has('vwap')) return { kind: 'vwap' };
  if (ids.has('range') || ids.has('support_resistance') || ids.has('breakout') || ids.has('liquidity_sweep') || ids.has('absorption')) return { kind: 'edge', of: 'range', mode: fade ? 'fade' : 'breakout' };
  return null;
}

function levelIn(text: string, r: RuleSetInput, primary: LevelRef | null): LevelRef | null {
  if (/previous day'?s? high|prior day'?s? high|yesterday'?s? high|\bPDH\b/i.test(text)) return { kind: 'pdh' };
  if (/previous day'?s? low|prior day'?s? low|yesterday'?s? low|\bPDL\b/i.test(text)) return { kind: 'pdl' };
  if (/opening range high|\bORH\b/i.test(text)) return { kind: 'orh', minutes: r.orbMinutes ?? 15 };
  if (/opening range low|\bORL\b/i.test(text)) return { kind: 'orl', minutes: r.orbMinutes ?? 15 };
  if (/opening range|\bORB\b/i.test(text)) return { kind: 'edge', of: 'or', mode: 'breakout', minutes: r.orbMinutes ?? 15 };
  if (/\bvwap\b/i.test(text)) return { kind: 'vwap' };
  const ema = /\b(\d+)\s*-?\s*(?:period\s*)?(ema|sma)\b/i.exec(text);
  if (ema) return { kind: 'ema', period: Number(ema[1]), maType: ema[2].toUpperCase() === 'SMA' ? 'SMA' : 'EMA' };
  if (/middle of the range|range mid(?:point)?/i.test(text)) return { kind: 'range_mid' };
  if (/(?:top|bottom|edges?) of the range|range edges?|(?:sell\w*|short\w*) the top|(?:buy\w*|long\w*) the bottom/i.test(text)) return { kind: 'edge', of: 'range', mode: 'fade' };
  if (/range (high|top)|\bresistance\b/i.test(text)) return { kind: 'range_high' };
  if (/range (low|bottom)|\bsupport\b/i.test(text)) return { kind: 'range_low' };
  if (/swing high/i.test(text)) return { kind: 'swing_high' };
  if (/swing low/i.test(text)) return { kind: 'swing_low' };
  if (/\b(it|the level|that level|trigger level|broken level|swept level|reference level|the range|the extreme)\b/i.test(text)) return primary;
  return null;
}

/** Parse every measurable part of a rule; several parts become an "all" primitive. */
export function parsePrimitive(text: string, r: RuleSetInput, primary: LevelRef | null): Primitive | null {
  const parts = text.split(/,\s*with\s+|\s+with\s+(?=volume)|;\s*|\s+and\s+(?=volume|the next|a candle|closes)/i);
  if (parts.length > 1) {
    const ps = parts.map((p) => parseSingle(p, r, primary));
    const ok = ps.filter((p): p is Primitive => !!p);
    if (ok.length === parts.length) return { type: 'all', of: ok };
  }
  return parseSingle(text, r, primary);
}

function parseSingle(text: string, r: RuleSetInput, primary: LevelRef | null): Primitive | null {
  const t = text;
  const lvl = levelIn(t, r, primary);
  // Definitions of the trader's levels: checkable as "the level exists".
  if (/^(opening range|previous day high\/low|vwap) =/i.test(t) || /^\d+-period (ema|sma)/i.test(t)) return lvl ? { type: 'level_available', level: lvl } : null;
  if (/^(sweep|absorption|signals are read|direction:|enter after:)/i.test(t)) return null;
  let m: RegExpExecArray | null;
  if (/^pullback =/i.test(t)) return { type: 'pullback_resume', bars: 3 };
  if ((m = /retraces? more than (\d+)% of/i.exec(t))) return { type: 'retrace_pct', pct: Number(m[1]), bars: 12 };
  if ((m = /top (\d+)% of its range/i.exec(t))) return { type: 'close_location', pct: Number(m[1]) };
  if ((m = /body (?:larger|greater|more|bigger) than (\d+)%/i.exec(t))) return { type: 'body_pct', min: Number(m[1]) };
  if ((m = /volume (?:above|greater than|over) (?:the )?previous (\d+)[- ]bar average/i.exec(t))) return { type: 'volume_vs_avg', bars: Number(m[1]), mult: 1 };
  if (/volume (?:is )?(?:above|greater than|over|higher than) (?:the )?(?:average|avg)|above[- ]average volume|high(?:er)? volume/i.test(t)) return { type: 'volume_vs_avg', bars: 20, mult: 1 };
  if (/\b(?:red|bearish|green|bullish) candle\b|candle closes? (?:green|red)/i.test(t) && !/\b(?:big|large)\b/i.test(t)) return { type: 'candle_dir' };
  if ((m = /range at least (\d+(?:\.\d+)?)× the average range of the previous (\d+)/i.exec(t))) return { type: 'range_vs_avg', bars: Number(m[2]), mult: Number(m[1]) };
  if ((m = /(\d+) consecutive .*shrinking bodies/i.exec(t))) return { type: 'shrinking_bodies', count: Number(m[1]) };
  if (/divergen/i.test(t)) return { type: 'rsi_divergence', period: Number(/RSI\s*\(?(\d+)/i.exec(t)?.[1] ?? 14), lookback: Number(/last (\d+)/i.exec(t)?.[1] ?? 20) };
  if (/2nd standard[- ]deviation vwap band/i.test(t)) return { type: 'vwap_band', sd: 2 };
  if ((m = /at least (\d+) average .*?candle ranges.*?(?:away from|from)/i.exec(t)) && /stretch/i.test(t)) return { type: 'stretched', level: lvl ?? primary ?? { kind: 'vwap' }, ranges: Number(m[1]) };
  if ((m = /covers at least (\d+) average/i.exec(t))) return { type: 'prior_move', ranges: Number(m[1]) };
  if ((m = /at least (\d+) higher highs and (\d+) higher lows/i.exec(t)) || /higher highs and higher lows/i.test(t)) return { type: 'trend_structure', swings: m ? Number(m[1]) : 2 };
  if ((m = /last (\d+) .*candles make higher highs/i.exec(t))) return { type: 'directional_candles', count: Number(m[1]) };
  if (/sweep|takes? out|trades? (?:below|above|through|beyond)/i.test(t) && lvl) return { type: 'sweep', level: lvl };
  if (/re-?test/i.test(t)) return { type: 'retest_hold', level: lvl ?? primary ?? { kind: 'edge', of: 'range', mode: 'breakout' } };
  if (/close[sd]? (?:back )?(?:inside|within)/i.test(t)) return lvl ?? primary ? { type: 'close_beyond', level: (lvl ?? primary)!, side: 'against_dir' } : null;
  if (/close[sd]?\s+(?:back\s+)?in the (?:trade|breakout|trend|drive) direction/i.test(t)) {
    const level = lvl ?? primary;
    return level && /level|range|swing|ema|vwap|high|low/i.test(t) ? { type: 'close_beyond', level, side: 'trade_dir' } : { type: 'candle_dir' };
  }
  if ((m = /close[sd]?\s+(?:back\s+)?(above|below|outside|beyond|through|in the trade direction|on the far side)/i.exec(t))) {
    const level = lvl ?? primary;
    if (!level) return null;
    const side = m[1] === 'above' ? 'above' : m[1] === 'below' ? 'below' : m[1] === 'on the far side' ? 'against_dir' : 'trade_dir';
    return { type: 'close_beyond', level, side };
  }
  if (/\btouch(?:es)?\b|\binto\b|pull ?backs? (?:to|into)|retraces? into|\b(?:sell\w*|short\w*|buy\w*) the (?:top|bottom)\b|\bedges?\b/i.test(t) && lvl) return { type: 'touch', level: lvl };
  if (/pull ?back|retrace/i.test(t) && !lvl) return { type: 'pullback_resume', bars: 3 };
  if ((lvl?.kind === 'ema') && /\b(above|below)\b/i.test(t)) return { type: 'ma_side', period: lvl.period, maType: lvl.maType };
  if (/\bbreak ?out\b|\bbreaks?\b/i.test(t) && (lvl ?? primary) && /close/i.test(r.originalText)) return { type: 'close_beyond', level: (lvl ?? primary)!, side: 'trade_dir' };
  if (/^\d+-minute close$|candle close/i.test(t) && primary) return { type: 'close_beyond', level: primary, side: 'trade_dir' };
  return null;
}

const ROLE_OF: Partial<Record<RuleSection, ConditionRole>> = {
  context: 'context',
  filter: 'context',
  bias: 'bias',
  setup: 'setup',
  entry: 'entry',
  confirmation: 'confirmation',
  volume: 'volume',
  volatility: 'volatility',
  invalidation: 'invalidation',
  noTrade: 'noTrade',
};

const confidenceOf = (r: StrategyRule): ConfidenceLabel => (r.provenance === 'trader' || r.provenance === 'inferred' ? 'A' : /requires testing|\d+%|×|\d+ average/i.test(r.text) ? 'D' : 'B');

function stopSpecOf(r: RuleSetInput, primary: LevelRef | null): StopSpec {
  const stop = r.rules.find((x) => x.section === 'stop');
  if (r.stopPoints != null) return { text: stop?.text ?? `Stop ${r.stopPoints} points`, kind: 'fixed_points', points: r.stopPoints, source: stop?.provenance ?? 'trader' };
  if (stop) {
    const t = stop.text;
    const pts = /(\d+(?:\.\d+)?)\s*(?:points?|pts?|handles?)/i.exec(t);
    if (pts) return { text: t, kind: 'fixed_points', points: Number(pts[1]), source: stop.provenance };
    const lvl = levelIn(t, r, primary);
    if (/sweep|reversal|retest|signal|absorption|stretch|divergence|swing|pullback|higher low|lower high/i.test(t)) return { text: t, kind: 'beyond_swing', source: stop.provenance };
    if (lvl || /level|range|zone/i.test(t)) return { text: t, kind: 'beyond_level', level: lvl ?? primary ?? undefined, source: stop.provenance };
    return { text: t, kind: 'beyond_signal_bar', source: stop.provenance };
  }
  return { text: 'Practice default: 1 tick beyond the signal candle (your plan has no stop yet)', kind: 'beyond_signal_bar', source: 'practice_default' };
}

function targetSpecOf(r: RuleSetInput): TargetSpec {
  const target = r.rules.find((x) => x.section === 'target');
  const pts = target ? /(\d+(?:\.\d+)?)\s*(?:points?|pts?|handles?)\s*(?:profit|target)|target (?:of )?(\d+(?:\.\d+)?)\s*(?:points?|pts?)/i.exec(target.text) : null;
  if (target && pts) {
    const points = Number(pts[1] ?? pts[2]);
    return { text: target.text, kind: 'points', points, r: r.stopPoints ? Math.round((points / r.stopPoints) * 100) / 100 : undefined, source: target.provenance };
  }
  if (target && /middle of the range|range mid/i.test(target.text)) return { text: target.text, kind: 'level', level: { kind: 'range_mid' }, source: target.provenance };
  const rr = r.minRR ?? (target ? Number(/\b(\d+(?:\.\d+)?)\s*R\b/.exec(target.text)?.[1] ?? /1\s*:\s*(\d+(?:\.\d+)?)/.exec(target.text)?.[1] ?? NaN) : NaN);
  if (target && Number.isFinite(rr)) return { text: target.text, kind: 'r_multiple', r: rr, source: target.provenance };
  if (Number.isFinite(rr)) return { text: `Minimum 1:${rr} reward:risk`, kind: 'r_multiple', r: rr, source: 'trader' };
  if (target) return { text: `${target.text} (practice measures it at 2R)`, kind: 'r_multiple', r: 2, source: target.provenance };
  return { text: 'Practice default: 2R (your plan has no target yet)', kind: 'r_multiple', r: 2, source: 'practice_default' };
}

/** A rule worded for one side only (in a plan that trades both sides). */
function sideOf(text: string): 'long' | 'short' | undefined {
  const short = /^(?:sell|selling|short|shorting)\b|\b(?:sell|short)\w* (?:at )?the (?:top|high|resistance)/i.test(text);
  const long = /^(?:buy|buying|long|going long)\b|\b(?:buy|long)\w* (?:at )?the (?:bottom|low|support)/i.test(text);
  return short && !long ? 'short' : long && !short ? 'long' : undefined;
}

const dirText = (d: TestableRuleSet['direction']) => (d === 'long' ? 'LONG' : d === 'short' ? 'SHORT' : 'LONG or SHORT');
const fmt = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function buildRuleSet(r: RuleSetInput): TestableRuleSet {
  const primary = primaryLevelOf(r);
  const isDefinition = (x: StrategyRule) => (x.provenance === 'inferred' && / = |^Signals are read/.test(x.text)) || /^Direction:|^Enter after:/.test(x.text);
  // "Trade a 15-minute ORB on ES", "Watch footprint charts" describe the plan; they are not conditions.
  const isDescription = (x: StrategyRule) => x.provenance === 'trader' && (x.section === 'context' || x.section === 'setup') && /^(?:trade|trades|scalp|watch|use|mark|look at)\b/i.test(x.text) && !/\b(?:when|if|only|after|wait|trend)\b/i.test(x.text);
  const definitions = r.rules.filter((x) => ROLE_OF[x.section] && (isDefinition(x) || isDescription(x)) && !/^Direction:|^Enter after:/.test(x.text)).map((x) => x.text);
  const conditions: RuleCondition[] = r.rules
    .filter((x) => ROLE_OF[x.section] && !isDefinition(x) && !isDescription(x))
    .map((x) => {
      const primitive = parsePrimitive(x.text, r, primary);
      const appliesTo = sideOf(x.text);
      return { id: x.id, role: ROLE_OF[x.section]!, text: x.text, source: x.provenance, confidence: confidenceOf(x), primitive, evaluable: !!primitive, ...(appliesTo ? { appliesTo } : {}) };
    });
  const direction: TestableRuleSet['direction'] = r.direction ?? 'both';
  const window = r.window.start && r.window.end ? { start: r.window.start, end: r.window.end } : null;
  const stop = stopSpecOf(r, primary);
  const target = targetSpecOf(r);
  const line = (c: RuleCondition): IfThenLine => ({ text: c.appliesTo && direction === 'both' ? `(${c.appliesTo === 'long' ? 'LONG' : 'SHORT'} side) ${c.text}` : c.text, evaluable: c.evaluable, source: c.source });
  const pre = conditions.filter((c) => ['context', 'bias', 'setup', 'volume', 'volatility'].includes(c.role));
  const triggers = conditions.filter((c) => c.role === 'entry' || c.role === 'confirmation');
  const blocks: IfThenBlock[] = [];
  const sessionLine: IfThenLine[] = window ? [{ text: `Time is between ${fmt(window.start)} and ${fmt(window.end)} ET`, evaluable: true, source: 'trader' }] : r.window.start ? [{ text: `Time is after ${fmt(r.window.start)} ET`, evaluable: true, source: 'trader' }] : [];
  if (pre.length || sessionLine.length) blocks.push({ kind: 'setup', if: [...sessionLine, ...pre.map(line)], then: triggers.length ? 'Setup active — wait for the entry trigger' : 'Setup active — look for the entry' });
  if (triggers.length) blocks.push({ kind: 'entry', if: triggers.map(line), then: `${dirText(direction)} entry is valid at the close of the trigger candle${triggers.some((c) => c.appliesTo) && direction === 'both' ? ' (side-specific lines apply only to that side)' : ''}` });
  const inval = conditions.filter((c) => c.role === 'invalidation');
  if (inval.length) blocks.push({ kind: 'invalidation', if: inval.map(line), then: 'Setup is void — no trade' });
  blocks.push({
    kind: 'exit',
    if: [
      { text: `STOP: ${stop.text}`, evaluable: stop.kind !== 'unspecified', source: stop.source === 'practice_default' ? 'suggested' : stop.source },
      { text: `TARGET: ${target.text}`, evaluable: target.kind !== 'unspecified', source: target.source === 'practice_default' ? 'suggested' : target.source },
    ],
    then: 'Exit at whichever is reached first',
  });
  const noTrade = conditions.filter((c) => c.role === 'noTrade');
  if (noTrade.length) blocks.push({ kind: 'noTrade', if: noTrade.map(line), then: 'Stand aside' });

  const counted = conditions.filter((c) => c.role !== 'noTrade');
  const evaluable = counted.filter((c) => c.evaluable).length;
  const practiceDefaults: string[] = [];
  if (stop.source === 'practice_default') practiceDefaults.push(stop.text);
  if (target.source === 'practice_default') practiceDefaults.push(target.text);
  if (!window) practiceDefaults.push('Practice default window: 9:30 AM – 3:30 PM ET');
  if (r.conceptIds.includes('orb') && r.orbMinutes == null) practiceDefaults.push('Practice default opening range: 15 minutes (your plan does not state the length)');
  if (conditions.some((c) => c.primitive && JSON.stringify(c.primitive).includes('range_'))) practiceDefaults.push('Practice approximates support / resistance / range edges with the high and low of the previous 2 hours');
  if (target.kind === 'points' && r.stopPoints == null) practiceDefaults.push('Points target measured against the practice stop');
  return {
    version: 1,
    strategyName: r.name,
    direction,
    instrument: r.instrument,
    timeframe: r.timeframes.find((x) => x.endsWith('m')) ?? r.timeframes[0] ?? null,
    window,
    primaryLevel: primary,
    definitions,
    conditions,
    stop,
    target,
    maxTrades: r.maxTrades,
    blocks,
    coverage: { evaluable, total: counted.length, testable: triggers.some((c) => c.evaluable) },
    practiceDefaults,
  };
}

// ───────────────────────────── Evaluation on candles (no lookahead) ─────────────────────────────

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function maSeries(closes: number[], period: number, type: 'EMA' | 'SMA'): number | null {
  if (closes.length < period) return null;
  if (type === 'SMA') return avg(closes.slice(-period));
  const k = 2 / (period + 1);
  let e = avg(closes.slice(0, period));
  for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}

function rsiSeries(closes: number[], period: number): number[] {
  const out: number[] = new Array(closes.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (i <= period) {
      gain += g / period;
      loss += l / period;
      if (i === period) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

interface EvalState {
  input: EvaluationInput;
  dir: 'long' | 'short';
  bars: readonly OhlcvBar[];
  i: number;
  avgRange: number;
  tick: number;
  cache: Map<string, number | null>;
}

function levelValue(ref: LevelRef, s: EvalState): number | null {
  const key = JSON.stringify(ref) + s.dir;
  if (s.cache.has(key)) return s.cache.get(key)!;
  const c = s.input.context;
  const prior = s.bars.slice(Math.max(0, s.i - 24), s.i);
  let v: number | null = null;
  switch (ref.kind) {
    case 'pdh':
      v = c.prevDay?.high ?? null;
      break;
    case 'pdl':
      v = c.prevDay?.low ?? null;
      break;
    case 'orh':
      v = c.openingRange(ref.minutes)?.high ?? null;
      break;
    case 'orl':
      v = c.openingRange(ref.minutes)?.low ?? null;
      break;
    case 'vwap':
      v = c.vwap;
      break;
    case 'ema':
      v = maSeries(s.bars.map((b) => b.close), ref.period, ref.maType);
      break;
    case 'swing_high':
    case 'range_high':
      v = prior.length >= 6 ? Math.max(...prior.map((b) => b.high)) : null;
      break;
    case 'swing_low':
    case 'range_low':
      v = prior.length >= 6 ? Math.min(...prior.map((b) => b.low)) : null;
      break;
    case 'range_mid':
      v = prior.length >= 6 ? (Math.max(...prior.map((b) => b.high)) + Math.min(...prior.map((b) => b.low))) / 2 : null;
      break;
    case 'edge': {
      const high = s.dir === 'long' ? ref.mode === 'breakout' : ref.mode === 'fade';
      if (ref.of === 'or') {
        const or = c.openingRange(ref.minutes ?? 15);
        v = or ? (high ? or.high : or.low) : null;
      } else if (ref.of === 'pd') v = c.prevDay ? (high ? c.prevDay.high : c.prevDay.low) : null;
      else v = prior.length >= 6 ? (high ? Math.max(...prior.map((b) => b.high)) : Math.min(...prior.map((b) => b.low))) : null;
      break;
    }
  }
  s.cache.set(key, v);
  return v;
}

/** true / false, or null when the data needed is not available yet. */
export function evaluatePrimitive(p: Primitive, s: EvalState): boolean | null {
  const b = s.bars[s.i];
  const long = s.dir === 'long';
  const range = b.high - b.low || s.tick;
  switch (p.type) {
    case 'level_available':
      return levelValue(p.level, s) != null;
    case 'close_beyond': {
      const L = levelValue(p.level, s);
      if (L == null) return null;
      const side = p.side === 'trade_dir' ? (long ? 'above' : 'below') : p.side === 'against_dir' ? (long ? 'below' : 'above') : p.side;
      return side === 'above' ? b.close > L : b.close < L;
    }
    case 'sweep': {
      const L = levelValue(p.level, s);
      if (L == null) return null;
      const recent = s.bars.slice(Math.max(0, s.i - 2), s.i + 1);
      return long ? Math.min(...recent.map((x) => x.low)) < L && b.close > L : Math.max(...recent.map((x) => x.high)) > L && b.close < L;
    }
    case 'retest_hold': {
      const L = levelValue(p.level, s);
      if (L == null) return null;
      const tol = Math.max(s.tick, s.avgRange * 0.25);
      const before = s.bars.slice(Math.max(0, s.i - 12), s.i - 1);
      const broke = before.some((x) => (long ? x.close > L : x.close < L));
      const touched = long ? b.low <= L + tol : b.high >= L - tol;
      return broke && touched && (long ? b.close > L : b.close < L);
    }
    case 'touch': {
      const L = levelValue(p.level, s);
      if (L == null) return null;
      const tol = Math.max(s.tick, s.avgRange * 0.15);
      return b.low <= L + tol && b.high >= L - tol;
    }
    case 'body_pct':
      return Math.abs(b.close - b.open) / range >= p.min / 100 && (long ? b.close > b.open : b.close < b.open);
    case 'close_location':
      return long ? (b.close - b.low) / range >= 1 - p.pct / 100 : (b.high - b.close) / range >= 1 - p.pct / 100;
    case 'volume_vs_avg': {
      const prev = s.bars.slice(Math.max(0, s.i - p.bars), s.i);
      return prev.length ? b.volume > p.mult * avg(prev.map((x) => x.volume)) : null;
    }
    case 'range_vs_avg': {
      const prev = s.bars.slice(Math.max(0, s.i - p.bars), s.i);
      return prev.length ? range >= p.mult * avg(prev.map((x) => x.high - x.low)) : null;
    }
    case 'stretched': {
      const L = levelValue(p.level, s);
      if (L == null) return null;
      return long ? L - b.close >= p.ranges * s.avgRange : b.close - L >= p.ranges * s.avgRange;
    }
    case 'vwap_band': {
      const c = s.input.context;
      if (c.vwap == null) return null;
      const sess = s.bars.slice(c.sessionStartIndex, s.i + 1);
      const sd = Math.sqrt(avg(sess.map((x) => ((x.high + x.low + x.close) / 3 - c.vwap!) ** 2)));
      return long ? b.close < c.vwap - p.sd * sd : b.close > c.vwap + p.sd * sd;
    }
    case 'trend_structure': {
      const seg = s.bars.slice(Math.max(0, s.i - 23), s.i + 1);
      if (seg.length < 12) return null;
      const chunks = [0, 1, 2, 3].map((k) => seg.slice(k * 6, k * 6 + 6)).filter((x) => x.length);
      const highs = chunks.map((x) => Math.max(...x.map((y) => y.high)));
      const lows = chunks.map((x) => Math.min(...x.map((y) => y.low)));
      let ups = 0;
      let downs = 0;
      for (let k = 1; k < chunks.length; k++) {
        if (highs[k] > highs[k - 1] && lows[k] > lows[k - 1]) ups++;
        if (highs[k] < highs[k - 1] && lows[k] < lows[k - 1]) downs++;
      }
      return long ? ups >= p.swings : downs >= p.swings;
    }
    case 'ma_side': {
      const m = maSeries(s.bars.map((x) => x.close), p.period, p.maType);
      return m == null ? null : long ? b.close > m : b.close < m;
    }
    case 'shrinking_bodies': {
      const prev = s.bars.slice(Math.max(0, s.i - p.count), s.i);
      if (prev.length < p.count) return null;
      const bodies = prev.map((x) => Math.abs(x.close - x.open));
      const shrinking = bodies.every((v, k) => k === 0 || v < bodies[k - 1]);
      return shrinking && (long ? b.close > b.open : b.close < b.open);
    }
    case 'rsi_divergence': {
      const closes = s.bars.map((x) => x.close);
      const rsi = rsiSeries(closes, p.period);
      const from = Math.max(0, s.i - p.lookback);
      if (s.i - from < 8) return null;
      const recent = [s.i - 2, s.i - 1, s.i].filter((k) => k >= 0);
      const earlier = Array.from({ length: Math.max(0, s.i - 3 - from) }, (_, k) => from + k);
      if (!earlier.length) return null;
      if (long) {
        const a = earlier.reduce((m, k) => (s.bars[k].low < s.bars[m].low ? k : m), earlier[0]);
        const c = recent.reduce((m, k) => (s.bars[k].low < s.bars[m].low ? k : m), recent[0]);
        return s.bars[c].low < s.bars[a].low && rsi[c] > rsi[a];
      }
      const a = earlier.reduce((m, k) => (s.bars[k].high > s.bars[m].high ? k : m), earlier[0]);
      const c = recent.reduce((m, k) => (s.bars[k].high > s.bars[m].high ? k : m), recent[0]);
      return s.bars[c].high > s.bars[a].high && rsi[c] < rsi[a];
    }
    case 'prior_move': {
      const prev = s.bars.slice(Math.max(0, s.i - 12), s.i + 1);
      return long ? Math.max(...prev.map((x) => x.high)) - b.low >= p.ranges * s.avgRange : b.high - Math.min(...prev.map((x) => x.low)) >= p.ranges * s.avgRange;
    }
    case 'retrace_pct': {
      const seg = s.bars.slice(Math.max(0, s.i - p.bars), s.i + 1);
      const hi = Math.max(...seg.map((x) => x.high));
      const lo = Math.min(...seg.map((x) => x.low));
      if (hi - lo <= 0) return null;
      return long ? (hi - b.close) / (hi - lo) > p.pct / 100 : (b.close - lo) / (hi - lo) > p.pct / 100;
    }
    case 'candle_dir':
      return long ? b.close > b.open : b.close < b.open;
    case 'pullback_resume': {
      const prev = s.bars.slice(Math.max(0, s.i - p.bars), s.i);
      if (!prev.length) return null;
      const against = prev.some((x) => (long ? x.close < x.open : x.close > x.open));
      return against && (long ? b.close > Math.max(...prev.map((x) => x.high)) - s.avgRange * 0.25 && b.close > b.open : b.close < Math.min(...prev.map((x) => x.low)) + s.avgRange * 0.25 && b.close < b.open);
    }
    case 'all': {
      const rs = p.of.map((x) => evaluatePrimitive(x, s));
      return rs.some((x) => x === false) ? false : rs.some((x) => x === null) ? null : true;
    }
    case 'directional_candles': {
      const prev = s.bars.slice(Math.max(0, s.i - p.count + 1), s.i + 1);
      if (prev.length < p.count) return null;
      return prev.every((x, k) => k === 0 || (long ? x.high > prev[k - 1].high && x.low > prev[k - 1].low : x.high < prev[k - 1].high && x.low < prev[k - 1].low));
    }
  }
}

const parseHhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export interface CompiledRuleSet extends StrategyEvaluator {
  ruleSet: TestableRuleSet;
}

/**
 * Compile a ruleset into a StrategyEvaluator. Only conditions with primitives
 * are checked on candles; the rest are reported as "confirm visually". A
 * signal needs every checkable condition to pass; when the trigger passes but
 * a setup condition does not, it is a near-miss (the correct decision is SKIP).
 */
export function compileRuleSet(rs: TestableRuleSet, strategyId: string): CompiledRuleSet {
  const window: [number, number] = rs.window ? [parseHhmm(rs.window.start), parseHhmm(rs.window.end)] : [RTH_OPEN, RTH_CLOSE - 30];
  const dirs: ('long' | 'short')[] = rs.direction === 'both' ? ['long', 'short'] : [rs.direction];
  const pre = rs.conditions.filter((c) => ['context', 'bias', 'setup', 'volume', 'volatility'].includes(c.role));
  const triggers = rs.conditions.filter((c) => c.role === 'entry' || c.role === 'confirmation');
  const noTrade = rs.conditions.filter((c) => c.role === 'noTrade' && c.evaluable);
  const rr = rs.target.r ?? 2;

  const evaluate = (input: EvaluationInput): SetupSignal | null => {
    if (!rs.coverage.testable) return null;
    const bars = input.bars;
    const i = bars.length - 1;
    const b = bars[i];
    const prev = bars.slice(Math.max(0, i - 20), i);
    const tick = getInstrument(input.instrument).tickSize;
    const avgRange = avg(prev.map((x) => x.high - x.low)) || tick * 4;
    let nearMiss: SetupSignal | null = null;
    for (const dir of dirs) {
      const s: EvalState = { input, dir, bars, i, avgRange, tick, cache: new Map() };
      const check = (c: RuleCondition) => (c.primitive ? evaluatePrimitive(c.primitive, s) : null);
      const forDir = (c: RuleCondition) => !c.appliesTo || c.appliesTo === dir;
      const dirTriggers = triggers.filter(forDir);
      const dirPre = pre.filter(forDir);
      const trig = dirTriggers.map(check);
      if (trig.some((v) => v === false) || !trig.some((v) => v === true)) continue;
      if (noTrade.some((c) => check(c) === true)) continue;
      const preResults = dirPre.map(check);
      const valid = preResults.every((v) => v !== false);
      // Stop and target from the plan (or labelled practice defaults).
      const entry = b.close;
      const sgn = dir === 'long' ? 1 : -1;
      let stop: number;
      if (rs.stop.kind === 'fixed_points' && rs.stop.points) stop = entry - sgn * rs.stop.points;
      else if (rs.stop.kind === 'beyond_level' && rs.stop.level) {
        const L = levelValue(rs.stop.level, s);
        stop = L != null ? L - sgn * tick * 2 : dir === 'long' ? b.low - tick : b.high + tick;
      } else if (rs.stop.kind === 'beyond_swing') {
        const last = bars.slice(Math.max(0, i - 4), i + 1);
        stop = dir === 'long' ? Math.min(...last.map((x) => x.low)) - tick : Math.max(...last.map((x) => x.high)) + tick;
      } else stop = dir === 'long' ? b.low - tick : b.high + tick;
      stop = roundToTick(input.instrument, stop);
      const risk = (entry - stop) * sgn;
      if (!(risk > 0)) continue;
      let target = roundToTick(input.instrument, entry + sgn * risk * rr);
      if (rs.target.kind === 'points' && rs.target.points) target = roundToTick(input.instrument, entry + sgn * rs.target.points);
      if (rs.target.kind === 'level' && rs.target.level) {
        const L = levelValue(rs.target.level, s);
        if (L != null && (L - entry) * sgn > 0) target = L;
      }
      const all = [...dirPre, ...dirTriggers];
      const results = [...preResults, ...trig];
      const primaryValue = rs.primaryLevel ? levelValue(rs.primaryLevel, s) : null;
      const levels: SetupLevel[] = primaryValue != null ? [{ label: 'Plan level', price: primaryValue, kind: dir === 'long' ? 'support' : 'resistance' }] : [];
      const signal: SetupSignal = {
        strategyId,
        strategyVersion: 'custom-1',
        direction: dir,
        valid,
        decisionIndex: i,
        decisionTimestamp: b.timestamp,
        entry,
        stop,
        target,
        riskReward: Math.round((Math.abs(target - entry) / risk) * 100) / 100,
        checks: all.map((c, k) => ({ label: c.text, passed: results[k] !== false, ...(c.evaluable ? {} : { detail: 'Not auto-checked — confirm visually' }) })),
        levels,
        features: setupFeatures(input, entry, 1, breakoutStrength(primaryValue != null ? Math.abs(entry - primaryValue) : range(b), input.context.atr), null),
      };
      if (valid) return signal;
      nearMiss ??= signal;
    }
    return nearMiss;
  };
  return { strategyId, version: 'custom-1', activeWindow: window, lookbackSessions: 1, evaluate, ruleSet: rs };
}

const range = (b: OhlcvBar) => b.high - b.low;
