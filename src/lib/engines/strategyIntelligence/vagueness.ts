import type { ConceptContext } from './concepts';
import type { ConfidenceLabel, RuleSection } from './types';

/**
 * Subjective wording that cannot be tested as written, with a measurable
 * replacement. Replacements are written in the trader's OWN vocabulary first
 * (price action, the levels/indicators they already use). A replacement only
 * brings in a new tool (VWAP, an EMA, ATR…) when the trader already uses it.
 * Thresholds are PROP GUARD SUGGESTIONS that require testing.
 */
export interface VagueTerm {
  key: string;
  pattern: RegExp;
  issue: (term: string) => string;
  suggest: (c: ConceptContext, fragment: string) => string;
  section?: RuleSection;
  /** D when the replacement invents a threshold; B when it only pins down the trader's own event. */
  confidence: ConfidenceLabel;
}

const tf = (c: ConceptContext) => (c.timeframe ? c.timeframe.replace(/m$/, '-minute').replace(/h$/, '-hour') : '5-minute');
const dirWord = (c: ConceptContext, up: string, down: string, any: string) => (c.direction === 'long' ? up : c.direction === 'short' ? down : any);
const uses = (c: ConceptContext, id: string) => c.concepts.includes(id);
const ma = (c: ConceptContext) => (c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'moving average');
/** The trader's own reference level, in their words. */
const levelOf = (c: ConceptContext, fallback = 'the trigger level') => c.level ?? (uses(c, 'orb') ? 'the opening range' : uses(c, 'moving_average') ? `the ${ma(c)}` : uses(c, 'support_resistance') ? 'the level' : fallback);

export const VAGUE_TERMS: VagueTerm[] = [
  {
    key: 'momentum_weakening',
    pattern: /momentum (?:starts? |begins? |is )?(?:to )?(weaken(?:s|ing)?|fad(?:es|ing)|slow(?:s|ing)?(?: down)?|dies|stall(?:s|ing)?|runs? out)/i,
    issue: (t) => `"${t}" is subjective — two traders would mark it on different candles.`,
    suggest: (c) => `Momentum weakening = 2 consecutive ${tf(c)} candles with shrinking bodies, followed by a candle that closes in the opposite direction`,
    confidence: 'D',
  },
  {
    key: 'momentum_strong',
    pattern: /(?:good|strong|big|real|clear) momentum|momentum (?:looks? |is |gets? )?(?:strong|good|returns?|picks? up|comes? back|kicks? in)|looks? strong|\bmomentum\b/i,
    issue: (t) => `"${t}" is subjective — "strong" has no threshold.`,
    suggest: (c) => `Entry candle (${tf(c)}) closes in the top 25% of its range in the trade direction, with volume above the previous 5-bar average`,
    confidence: 'D',
  },
  {
    key: 'looks_directional',
    pattern: /looks? (?:bullish|bearish|weak|heavy|toppy|bottomy)|feels? (?:toppy|heavy|bullish|bearish)/i,
    issue: (t) => `"${t}" is an impression, not a condition.`,
    suggest: (c) => `Bullish = the last 3 ${tf(c)} candles make higher highs and higher lows and the last close is above the prior candle's midpoint (mirror for bearish)`,
    confidence: 'D',
  },
  {
    key: 'wait_confirmation',
    pattern: /wait (?:for )?(?:a |the |some )?confirmation|(?:once|when|after) (?:it'?s |it is )?confirmed|\bconfirmation\b(?! candle)/i,
    issue: () => '"Confirmation" is not defined — it can mean anything after the fact.',
    suggest: (c) => `Confirmation = a ${tf(c)} candle closes beyond ${levelOf(c)} in the trade direction (a wick through does not count)`,
    section: 'confirmation',
    confidence: 'B',
  },
  {
    key: 'big_candle',
    pattern: /(?:big|large|huge|strong|wide|massive) (?:candle|bar|green candle|red candle)/i,
    issue: (t) => `"${t}" has no size defined.`,
    suggest: (c) => `Big = ${tf(c)} candle range at least 1.5× the average range of the previous 10 candles`,
    confidence: 'D',
  },
  {
    key: 'clean_breakout',
    pattern: /clean (?:break ?out|break|move|setup|retest)/i,
    issue: (t) => `"${t}" is a judgment call.`,
    suggest: (c) => `Clean = a ${tf(c)} close beyond ${levelOf(c)} by at least 2 ticks, with no more than 1 touch of the level in the previous 10 candles`,
    confidence: 'D',
  },
  {
    key: 'stretched',
    pattern: /(?:stretched|over-?extended|extended|too far|far (?:away )?)(?: (?:away )?from(?: the)? \w+)?/i,
    issue: (t) => `"${t}" has no distance defined.`,
    suggest: (c) =>
      uses(c, 'vwap')
        ? 'Stretched = price closes outside the 2nd standard-deviation VWAP band'
        : uses(c, 'moving_average')
          ? `Stretched = price closes at least 3 average candle ranges away from the ${ma(c)}`
          : `Stretched = price at least 3 average ${tf(c)} candle ranges (last 20 candles) away from ${levelOf(c, 'the level it moved from')}`,
    confidence: 'D',
  },
  {
    key: 'large_move',
    pattern: /(?:large|big|huge|massive|hard|sharp|heavy|strong) (?:sell-?off|selloff|drop|dump|flush|rally|move|push|leg)|(?:dumps?|push(?:es)?|moves?|runs?|drives?) hard|sells? off hard|\brips?\b|\btanks?\b/i,
    issue: (t) => `"${t}" has no size defined.`,
    suggest: (c) => `${dirWord(c, 'Selloff', 'Rally', 'Move')} covers at least 4 average ${tf(c)} candle ranges from the last swing ${dirWord(c, 'high', 'low', 'point')} before the setup counts`,
    section: 'context',
    confidence: 'D',
  },
  {
    key: 'quickly',
    pattern: /\b(quickly|fast|immediately|right away|soon after|sharply)\b/i,
    issue: (t) => `"${t}" has no time limit.`,
    suggest: (c) => `Must happen within 2 ${tf(c)} candles of the trigger`,
    confidence: 'D',
  },
  {
    key: 'strong_trend',
    pattern: /strong(?:ly)? trend(?:s|ing)?|clear trend|trending (?:strongly|hard|well)|trend(?:s)? (?:is |are )?strong/i,
    issue: (t) => `"${t}" — "strong" is not measurable.`,
    suggest: (c) =>
      uses(c, 'moving_average')
        ? `Trend = price above a rising ${ma(c)} with at least 2 higher highs and 2 higher lows on the ${c.timeframe === '1h' ? '4-hour' : '15-minute'} chart (mirror for downtrends)`
        : `Trend = at least 2 higher highs and 2 higher lows on the ${c.timeframe === '1h' ? '4-hour' : '15-minute'} chart, last pullback holding above the prior swing low (mirror for downtrends)`,
    section: 'bias',
    confidence: 'D',
  },
  {
    key: 'aggressive',
    pattern: /aggressive (?:buyers|sellers|buying|selling)|heavy (?:buying|selling)/i,
    issue: (t) => `"${t}" — aggression needs a delta or imbalance threshold.`,
    suggest: () => 'Aggressive = a footprint bar at the level with delta beyond −/+ 2× its 20-bar average, or 3 stacked imbalances (300% ratio)',
    confidence: 'D',
  },
  {
    key: 'absorbed',
    pattern: /absorb(?:ed|s|ing)?|absorption/i,
    issue: (t) => `"${t}" needs an observable definition.`,
    suggest: (c) => `Absorption = the bar at the level has top-10% volume for the session while price fails to make a new ${dirWord(c, 'low', 'high', 'extreme')}; the next ${tf(c)} bar closes ${dirWord(c, 'up', 'down', 'away from the level')}`,
    confidence: 'D',
  },
  {
    key: 'undefined_level',
    pattern: /\b(?:at |into |near |off )?(?:key |major |strong |important )?(support|resistance|levels?|zones?)\b/i,
    issue: (t) => `"${t}" is not defined — which levels count must be decided before the session.`,
    suggest: () => 'Valid levels = swing highs/lows that were touched at least twice in the last 2 sessions, marked before the session starts (max 4 per day)',
    section: 'setup',
    confidence: 'B',
  },
  {
    key: 'reverses',
    pattern: /\breverses?\b|\breversal\b|turns? (?:around|back)|bounces?/i,
    issue: (t) => `"${t}" — reversal needs a confirming event.`,
    suggest: (c) => `Reversal confirmed by a ${tf(c)} candle that closes back ${dirWord(c, 'above', 'below', 'across')} ${levelOf(c, 'the reference level')}`,
    section: 'confirmation',
    confidence: 'B',
  },
  {
    key: 'divergence',
    pattern: /\bdivergen(?:ce|t)\b/i,
    issue: () => 'Divergence needs a lookback and swing definition.',
    suggest: (c) => `Divergence = price makes a lower low (higher high) vs the previous swing within the last 20 ${tf(c)} candles while RSI(14) makes a higher low (lower high)`,
    confidence: 'D',
  },
  {
    key: 'quality',
    pattern: /\b(nice|good|perfect|obvious|solid|beautiful|ideal|decent|proper)\b(?! (?:risk|reward|r:r|momentum))/i,
    issue: (t) => `"${t}" is a judgment call, not a rule.`,
    suggest: () => 'Replace with the observable features that make it qualify (e.g. no overlapping candles in the last 3 bars, level touched at most twice)',
    confidence: 'B',
  },
  {
    key: 'feel',
    pattern: /\b(feel(?:s|ing)?|gut|intuition|seems?|looks? like|i think|sense)\b/i,
    issue: (t) => `"${t}" is discretionary — it cannot be checked or tested.`,
    suggest: () => 'State the specific chart condition you are reacting to, so the same situation always produces the same decision',
    confidence: 'B',
  },
  {
    key: 'breakout_undefined',
    pattern: /\bbreak ?outs?\b/i,
    issue: () => 'A breakout is not defined (wick through, or candle close beyond the level?).',
    suggest: (c) => `Breakout = a ${tf(c)} candle closes beyond ${levelOf(c)} by at least 1 tick (wicks do not count)`,
    section: 'confirmation',
    confidence: 'B',
  },
  {
    key: 'pullback_undefined',
    pattern: /\bpull ?backs?\b|\bdips?\b/i,
    issue: () => 'A pullback is not defined (how deep, into what?).',
    suggest: (c) => `Pullback = price retraces into ${uses(c, 'moving_average') ? `the ${ma(c)}` : 'the prior breakout level or the last swing'} without a ${tf(c)} close beyond it`,
    section: 'setup',
    confidence: 'B',
  },
];

/** Some words are only vague when the description gives no definition. */
function isDefinedElsewhere(key: string, text: string): boolean {
  if (key === 'breakout_undefined') return /close[sd]?|closing|candle close/i.test(text);
  if (key === 'pullback_undefined') return /\b\d+\s*-?\s*(ema|sma|ma)\b|\bvwap\b|fib|\d+(\.\d+)?%/i.test(text) && /\binto\b|\bto the\b/i.test(text);
  if (key === 'undefined_level') return /previous day|prior day|yesterday|overnight|\bPDH\b|\bPDL\b|\bONH\b|\bONL\b|vwap|opening range|\bORB\b|\bPOC\b|value area|swing (high|low)/i.test(text);
  if (key === 'wait_confirmation') return /close[sd]? (above|below|beyond|outside|back)|candle close|engulf/i.test(text);
  if (key === 'divergence') return /\bRSI\s*\(?\d+|\d+\s*-?\s*period/i.test(text) && /swing|lookback|\d+ (bars|candles)/i.test(text);
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
    if (term.key === 'momentum_strong' && seen.has('momentum_weakening')) continue;
    if (term.key === 'quality' && seen.has('clean_breakout')) continue;
    if (term.key === 'feel' && seen.has('looks_directional')) continue;
    if (term.key === 'breakout_undefined' && seen.has('clean_breakout')) continue;
    if (isDefinedElsewhere(term.key, fullText)) continue;
    if (term.key === 'undefined_level' && !/\b(at|into|near|off|from)\b/i.test(fragment)) continue;
    seen.add(term.key);
    hits.push({ term, match: m[0].trim() });
  }
  return hits;
}

/** Tools a suggestion would introduce that the trader never mentioned. */
const TOOL_PATTERNS: [string, RegExp][] = [
  ['vwap', /\bvwap\b/i],
  ['moving_average', /\b\d*\s*(ema|sma)\b|moving average/i],
  ['orb', /opening range|\bORB\b/i],
  ['atr', /\bATR\b|average (true|daily) range/i],
  ['indicator', /\bRSI\b|\bMACD\b|stochastic|bollinger/i],
  ['order_flow', /footprint|\bdelta\b|imbalance/i],
  ['volume_profile', /volume[- ]profile|\bPOC\b|value area|high-volume node/i],
];

export function introducedTools(suggestion: string, traderText: string): string[] {
  return TOOL_PATTERNS.filter(([, re]) => re.test(suggestion) && !re.test(traderText)).map(([id]) => id);
}
