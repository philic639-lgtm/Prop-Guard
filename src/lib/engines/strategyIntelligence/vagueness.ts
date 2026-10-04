import type { ConceptContext } from './concepts';
import type { RuleSection } from './types';

/**
 * Subjective wording that cannot be tested as written, with a measurable
 * replacement. Replacement thresholds are PROP GUARD SUGGESTIONS — the UI
 * always labels them as such and the trader accepts, edits or rejects them.
 */
export interface VagueTerm {
  key: string;
  pattern: RegExp;
  /** Why it is not testable. */
  issue: (term: string) => string;
  /** Measurable replacement. */
  suggest: (c: ConceptContext, fragment: string) => string;
  /** Section the replacement belongs to when it differs from the fragment's. */
  section?: RuleSection;
}

const tf = (c: ConceptContext) => (c.timeframe ? c.timeframe.replace(/m$/, '-minute').replace(/h$/, '-hour') : '5-minute');
const dirWord = (c: ConceptContext, up: string, down: string, any: string) => (c.direction === 'long' ? up : c.direction === 'short' ? down : any);

export const VAGUE_TERMS: VagueTerm[] = [
  {
    key: 'momentum_weakening',
    pattern: /momentum (?:starts? |begins? |is )?(?:to )?(weaken(?:s|ing)?|fad(?:es|ing)|slow(?:s|ing)?(?: down)?|dies|stall(?:s|ing)?|runs? out)/i,
    issue: (t) => `"${t}" is subjective — two traders would mark it on different candles.`,
    suggest: (c) => `Momentum weakening = 2 consecutive ${tf(c)} candles with shrinking bodies, followed by a candle that closes in the opposite direction`,
  },
  {
    key: 'momentum_strong',
    pattern: /momentum (?:looks? |is |gets? )?(?:strong|good|returns?|picks? up|comes? back|kicks? in)|strong momentum|looks? strong|momentum/i,
    issue: (t) => `"${t}" is subjective — "strong" has no threshold.`,
    suggest: (c) => `Require a ${tf(c)} candle that closes beyond the trigger level with a body larger than 50% of its total range`,
  },
  {
    key: 'stretched',
    pattern: /(?:stretched|over-?extended|extended|too far|far (?:away )?)(?: (?:away )?from(?: the)? \w+)?/i,
    issue: (t) => `"${t}" has no distance defined.`,
    suggest: (c, f) =>
      /vwap/i.test(f) || /vwap/i.test(c.text)
        ? 'Stretched = price closes outside the 2nd standard-deviation VWAP band (or at least 1.5× the 14-period ATR away from VWAP)'
        : 'Stretched = price at least 1.5× the 14-period ATR away from the 20 EMA',
  },
  {
    key: 'large_move',
    pattern: /(?:large|big|huge|massive|hard|sharp|heavy|strong) (?:sell-?off|selloff|drop|dump|flush|rally|move|push|leg)|dumps? hard|sells? off hard|rips?|tanks?/i,
    issue: (t) => `"${t}" has no size defined.`,
    suggest: (c) => `${dirWord(c, 'Selloff', 'Rally', 'Move')} of at least 1× the 14-day average daily range from the session ${dirWord(c, 'high', 'low', 'extreme')} (or a fixed point amount you choose) before the setup counts`,
    section: 'context',
  },
  {
    key: 'quickly',
    pattern: /\b(quickly|fast|immediately|right away|soon after|sharply)\b/i,
    issue: (t) => `"${t}" has no time limit.`,
    suggest: (c) => `Must happen within 2 ${tf(c)} candles of the trigger`,
  },
  {
    key: 'strong_trend',
    pattern: /strong(?:ly)? trend(?:s|ing)?|clear trend|trending (?:strongly|hard|well)|trend(?:s)? (?:is |are )?strong/i,
    issue: (t) => `"${t}" — "strong" is not measurable.`,
    suggest: (c) =>
      `Trend = ${c.emaPeriod ?? 20} EMA above the 50 EMA and both rising, with higher highs and higher lows on the ${c.timeframe === '1h' ? '4-hour' : '15-minute'} chart (mirror for downtrends)`,
    section: 'bias',
  },
  {
    key: 'aggressive',
    pattern: /aggressive (?:buyers|sellers|buying|selling)|heavy (?:buying|selling)/i,
    issue: (t) => `"${t}" — aggression needs a delta or imbalance threshold.`,
    suggest: () => 'Aggressive = a footprint bar at the level with delta beyond −/+ 2× its 20-bar average, or 3 stacked imbalances (300% ratio)',
  },
  {
    key: 'absorbed',
    pattern: /absorb(?:ed|s|ing)?|absorption/i,
    issue: (t) => `"${t}" needs an observable definition.`,
    suggest: (c) =>
      `Absorption = the bar at the level has top-10% volume for the session while price fails to make a new ${dirWord(c, 'low', 'high', 'extreme')}; the next ${tf(c)} bar closes ${dirWord(c, 'up', 'down', 'away from the level')}`,
  },
  {
    key: 'undefined_level',
    pattern: /\b(?:at |into |near |off )?(?:key |major |strong |important )?(support|resistance|levels?|zones?)\b/i,
    issue: (t) => `"${t}" is not defined — which levels count must be decided before the session.`,
    suggest: () => 'Valid levels = prior day high/low, overnight high/low, or a volume-profile level marked before 9:30 ET (max 4 levels per session)',
    section: 'setup',
  },
  {
    key: 'reverses',
    pattern: /\breverses?\b|\breversal\b|turns? (?:around|back)|bounces?/i,
    issue: (t) => `"${t}" — reversal needs a confirming event.`,
    suggest: (c) => `Reversal confirmed by a ${tf(c)} candle that closes back ${dirWord(c, 'above', 'below', 'across')} ${c.level ?? 'the reference level'}`,
    section: 'confirmation',
  },
  {
    key: 'quality',
    pattern: /\b(clean|nice|good|perfect|obvious|solid|beautiful|ideal|decent|proper)\b(?! (?:risk|reward|r:r))/i,
    issue: (t) => `"${t}" is a judgment call, not a rule.`,
    suggest: () => 'Replace with the observable features that make it qualify (e.g. no overlapping candles in the last 3 bars, level touched at most twice)',
  },
  {
    key: 'feel',
    pattern: /\b(feel(?:s|ing)?|gut|intuition|seems?|looks? like|i think|sense)\b/i,
    issue: (t) => `"${t}" is discretionary — it cannot be checked or tested.`,
    suggest: () => 'State the specific chart condition you are reacting to, so the same situation always produces the same decision',
  },
  {
    key: 'breakout_undefined',
    pattern: /\bbreak ?outs?\b/i,
    issue: () => 'A breakout is not defined (wick through, or candle close beyond the level?).',
    suggest: (c) => `Breakout = a ${tf(c)} candle closes beyond the level by at least 1 tick (wicks do not count)`,
    section: 'confirmation',
  },
  {
    key: 'pullback_undefined',
    pattern: /\bpull ?backs?\b|\bdips?\b/i,
    issue: () => 'A pullback is not defined (how deep, into what?).',
    suggest: (c) => `Pullback = price retraces into the ${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'prior breakout level'} without a ${tf(c)} close beyond it`,
    section: 'setup',
  },
];

/** Breakouts / pullbacks are only vague when the description gives no definition. */
function isDefinedElsewhere(key: string, text: string): boolean {
  if (key === 'breakout_undefined') return /close[sd]?|closing|candle close/i.test(text);
  if (key === 'pullback_undefined') return /\b\d+\s*-?\s*(ema|sma|ma)\b|\bvwap\b|fib|\d+(\.\d+)?%/i.test(text) && /\binto\b|\bto the\b/i.test(text);
  if (key === 'undefined_level') return /previous day|prior day|yesterday|overnight|\bPDH\b|\bPDL\b|\bONH\b|\bONL\b|vwap|opening range|\bORB\b|\bPOC\b|value area/i.test(text);
  if (key === 'momentum_strong') return false;
  return false;
}

export interface VagueHit {
  term: VagueTerm;
  match: string;
}

export function findVagueTerms(fragment: string, fullText: string): VagueHit[] {
  const hits: VagueHit[] = [];
  const seen = new Set<string>();
  for (const term of VAGUE_TERMS) {
    const m = term.pattern.exec(fragment);
    if (!m) continue;
    // "momentum weakening" also matches the generic momentum term — keep the specific one.
    if (term.key === 'momentum_strong' && seen.has('momentum_weakening')) continue;
    if (isDefinedElsewhere(term.key, fullText)) continue;
    // Bare "support"/"levels" are vague only when used as the trade location.
    if (term.key === 'undefined_level' && !/\b(at|into|near|off|from)\b/i.test(fragment)) continue;
    seen.add(term.key);
    hits.push({ term, match: m[0].trim() });
  }
  return hits;
}
