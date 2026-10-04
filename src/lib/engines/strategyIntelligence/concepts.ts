import type { StrategyStyleId } from './types';

/**
 * Trading concepts Prop Guard recognizes in free text. This is a vocabulary,
 * NOT a list of allowed strategies: a description can match any combination
 * of concepts, or none — then it is classified "Other / Custom" and analysed
 * from its own words. No concept supplies default parameters (no default ORB
 * length, window, stop or target); knowledge here is used only to interpret
 * terms the trader actually used and to word suggestions.
 */

export interface ConceptContext {
  text: string;
  direction: 'long' | 'short' | 'both' | null;
  /** Execution timeframe if stated (e.g. "5m"). */
  timeframe: string | null;
  orbMinutes: number | null;
  emaPeriod: number | null;
  emaType: string | null;
  /** Named reference level the trader used (e.g. "previous day's low"). */
  level: string | null;
}

export interface ConceptKnowledge {
  /** Standard definitions of the terms the trader used (provenance: inferred). */
  inferred?: (c: ConceptContext) => string[];
  /** Name fragment for the strategy title. */
  name?: (c: ConceptContext) => string;
  stop?: (c: ConceptContext) => string;
  target?: (c: ConceptContext) => string;
  invalidation?: (c: ConceptContext) => string;
  entry?: (c: ConceptContext) => string;
  noTrade?: (c: ConceptContext) => string;
}

export interface Concept extends ConceptKnowledge {
  id: StrategyStyleId;
  label: string;
  patterns: RegExp[];
  /** Higher = more specific; used to order styles and pick suggestion wording. */
  specificity: number;
}

/** Stated timeframe, else 5-minute — suggestions are labelled as Prop Guard's, so proposing one is honest. */
const tf = (c: ConceptContext) => (c.timeframe ? `${c.timeframe.replace(/m$/, '-minute').replace(/h$/, '-hour')}` : '5-minute');
const side = (c: ConceptContext, long: string, short: string, both: string) => (c.direction === 'long' ? long : c.direction === 'short' ? short : both);

export const CONCEPTS: Concept[] = [
  {
    id: 'orb',
    label: 'Opening Range Breakout',
    specificity: 10,
    patterns: [/\bORB\b/i, /opening[- ]range/i],
    inferred: (c) => [
      c.orbMinutes
        ? `Opening range = high and low of the first ${c.orbMinutes} minutes after the 9:30 ET open`
        : 'Opening range = high and low of the first minutes after the 9:30 ET open (length not stated)',
    ],
    name: (c) => `${c.orbMinutes ? `${c.orbMinutes}M ` : ''}ORB`,
    stop: (c) => side(c, 'Stop 1 tick below the retest low (or back inside the opening range, whichever is closer)', 'Stop 1 tick above the retest high (or back inside the opening range, whichever is closer)', 'Stop 1 tick beyond the retest extreme on the opposite side of the trade'),
    target: () => 'First target at 2R; optional runner to a measured move equal to the opening-range height',
    invalidation: (c) => `Setup is void if a ${tf(c)} candle closes back inside the opening range after the breakout`,
    noTrade: () => 'Skip if the opening range is wider than 50% of the 14-day average daily range',
  },
  {
    id: 'opening_drive',
    label: 'Opening Drive',
    specificity: 9,
    patterns: [/opening drive|open(?:ing)? drive|drive off the open/i],
    stop: () => 'Stop beyond the first pullback extreme after the open',
    target: () => 'Target 2R or the prior day high/low in the drive direction, whichever comes first',
    invalidation: () => 'Void if price retraces more than 50% of the opening drive before entry',
    name: () => 'Opening Drive',
  },
  {
    id: 'liquidity_sweep',
    label: 'Liquidity Sweep',
    specificity: 9,
    patterns: [/\bsweep(s|ing|ed)?\b/i, /stop (hunt|run)/i, /liquidity (grab|raid|sweep)/i, /takes? out (the )?(low|high|stops)/i, /\bspring\b|\bupthrust\b/i],
    inferred: (c) => [
      `Sweep = price trades beyond ${c.level ?? 'the reference level'} and then closes back on the other side of it`,
    ],
    name: (c) => `${c.level ? `${abbreviateLevel(c.level)} ` : ''}Sweep`,
    stop: (c) => side(c, '1 tick below the low of the sweep', '1 tick above the high of the sweep', '1 tick beyond the sweep extreme'),
    target: (c) => side(c, 'First target at the session VWAP or 2R, whichever is closer', 'First target at the session VWAP or 2R, whichever is closer', 'First target at VWAP or 2R, whichever is closer'),
    invalidation: (c) => `Void if a ${tf(c)} candle closes back beyond ${c.level ?? 'the swept level'} after entry`,
    entry: (c) => `Enter on the first ${tf(c)} candle close back ${side(c, 'above', 'below', 'inside')} ${c.level ?? 'the swept level'}`,
  },
  {
    id: 'order_flow',
    label: 'Order Flow',
    specificity: 9,
    patterns: [/footprint/i, /order ?flow/i, /\bdelta\b/i, /\bDOM\b|depth of market|\btape\b/i, /imbalance/i, /iceberg/i, /aggressive (buyers|sellers)/i],
    inferred: () => ['Signals are read from footprint / order-flow data at the level (not from candles alone)'],
    name: () => 'Order Flow',
    stop: (c) => side(c, '2 ticks below the absorption low', '2 ticks above the absorption high', '2 ticks beyond the absorption extreme'),
    target: () => 'First target at the next visible high-volume node or 2R, whichever is closer',
    invalidation: () => 'Void if price trades through the absorption level with continued aggressive volume',
  },
  {
    id: 'absorption',
    label: 'Absorption',
    specificity: 9,
    patterns: [/absorb(s|ed|ing)?\b|absorption/i],
    inferred: (c) => [
      `Absorption = heavy ${side(c, 'selling', 'buying', 'aggressive')} volume trades into the level while price fails to move through it`,
    ],
    name: () => 'Absorption',
  },
  {
    id: 'mean_reversion',
    label: 'Mean Reversion',
    specificity: 8,
    patterns: [/\bfade(s|d|ing)?\b/i, /stretched|over-?extended|too far (from|away)|far (away )?from/i, /mean[- ]revert|mean reversion|snap ?back|back to (the )?(mean|vwap|average)/i],
    name: () => 'Mean Reversion',
    stop: () => 'Stop 1 tick beyond the extreme of the stretch (the high/low made before the turn)',
    target: () => 'Target a return to VWAP (the mean), with a minimum of 1.5R',
    invalidation: (c) => `Void if price makes a new extreme with a ${tf(c)} candle close beyond the stretch high/low`,
    noTrade: () => 'Do not fade on trend days (price has not touched VWAP since the first 30 minutes)',
  },
  {
    id: 'vwap',
    label: 'VWAP',
    specificity: 7,
    patterns: [/\bvwap\b/i],
    inferred: () => ['VWAP = session VWAP anchored at the 9:30 ET regular-session open'],
    name: () => 'VWAP',
  },
  {
    id: 'moving_average',
    label: 'Moving Average',
    specificity: 7,
    patterns: [/\b\d+\s*-?\s*(ema|sma|ma)\b/i, /moving average/i, /\b(ema|sma)\s*\d+\b/i],
    inferred: (c) => [
      `${c.emaPeriod ? `${c.emaPeriod}-period ${c.emaType ?? 'EMA'}` : 'Moving average'} ${c.timeframe ? `on the ${tf(c)} chart` : 'on your execution chart (timeframe not stated)'}`,
    ],
    name: (c) => `${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'MA'}`,
    stop: (c) => side(c, '1 tick below the pullback swing low', '1 tick above the pullback swing high', '1 tick beyond the pullback swing point'),
    target: () => 'First target at the prior swing high/low in the trend direction, minimum 2R',
    invalidation: (c) => `Void if a ${tf(c)} candle closes on the far side of the ${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'moving average'} before entry`,
    entry: (c) => `Enter on the first ${tf(c)} candle that touches the ${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'moving average'} and closes back in the trend direction`,
  },
  {
    id: 'pdh_pdl',
    label: 'Previous Day High/Low',
    specificity: 7,
    patterns: [/previous day'?s? (high|low)|prior day'?s? (high|low)|yesterday'?s? (high|low)|\bPDH\b|\bPDL\b/i],
    inferred: () => ['Previous day high/low = prior regular-session (9:30–16:00 ET) extremes'],
  },
  {
    id: 'retest',
    label: 'Breakout + Retest',
    specificity: 6,
    patterns: [/re-?test/i],
    name: () => 'Retest',
    entry: (c) => `Enter when the retest holds: a ${tf(c)} candle touches the broken level and closes back in the breakout direction`,
  },
  {
    id: 'breakout',
    label: 'Breakout',
    specificity: 5,
    patterns: [/break ?outs?\b|breaks? (above|below|out|through)|breakdown/i],
    name: () => 'Breakout',
    stop: () => 'Stop 1 tick back inside the broken level (beyond the breakout candle midpoint)',
    target: () => 'First target at 2R; trail the rest behind each new swing',
    invalidation: (c) => `Void if a ${tf(c)} candle closes back inside the broken level`,
  },
  {
    id: 'reversal',
    label: 'Reversal',
    specificity: 5,
    patterns: [/revers(al|es|e|ing)/i, /closes? back (above|below|inside)/i, /reclaim/i, /fail(ed|ure)? (break(out|down)|auction)/i, /v[- ]?(bottom|top)/i, /(dump|selloff|sell-off|flush)[^.]*?(then|and)?[^.]*?(revers|bounce|reclaim|back above)/i],
    name: () => 'Reversal',
    stop: (c) => side(c, '1 tick below the reversal low', '1 tick above the reversal high', '1 tick beyond the reversal extreme'),
    target: () => 'First target at 2R or the start of the move that reversed, whichever is closer',
    invalidation: () => 'Void if price makes a new extreme beyond the reversal point',
  },
  {
    id: 'trend_continuation',
    label: 'Trend Continuation',
    specificity: 5,
    patterns: [/\btrend(s|ing)?\b(?!\s*line)/i, /continuation/i, /with the trend/i, /higher highs?|lower lows?/i],
    name: () => 'Trend',
    stop: (c) => side(c, '1 tick below the most recent higher low', '1 tick above the most recent lower high', '1 tick beyond the most recent swing point'),
    target: () => 'First target at the prior trend extreme, minimum 2R',
    invalidation: () => 'Void if the trend structure breaks (a lower low in an uptrend / higher high in a downtrend)',
  },
  {
    id: 'pullback',
    label: 'Pullback',
    specificity: 5,
    patterns: [/pull ?backs?|retrace(ment|s)?|\bdips?\b/i],
    name: () => 'Pullback',
  },
  {
    id: 'support_resistance',
    label: 'Support / Resistance',
    specificity: 4,
    patterns: [/\bsupport\b|\bresistance\b|key levels?/i],
    stop: (c) => side(c, '2 ticks below the support level', '2 ticks above the resistance level', '2 ticks beyond the level'),
    target: () => 'Target the next opposing level, minimum 2R',
    invalidation: (c) => `Void if a ${tf(c)} candle closes through the level`,
  },
  {
    id: 'supply_demand',
    label: 'Supply / Demand',
    specificity: 6,
    patterns: [/supply|demand zone|\bzones?\b/i],
    name: () => 'Supply/Demand',
    stop: () => 'Stop 1 tick beyond the far edge of the zone',
    target: () => 'Target the opposing zone, minimum 2R',
    invalidation: () => 'Void after the zone has been tested twice or traded through',
  },
  {
    id: 'market_structure',
    label: 'Market Structure',
    specificity: 6,
    patterns: [/break of structure|\bBOS\b|\bCHoCH\b|market structure|change of character/i],
    name: () => 'Structure',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    specificity: 3,
    patterns: [/momentum/i, /impulse|explosive|thrust/i],
  },
  {
    id: 'volume',
    label: 'Volume',
    specificity: 4,
    patterns: [/\bvolume\b|\bRVOL\b|volume profile|\bPOC\b|value area|\bVAH\b|\bVAL\b/i],
  },
  {
    id: 'trendline',
    label: 'Trendline',
    specificity: 6,
    patterns: [/trend ?lines?/i],
    name: () => 'Trendline',
    stop: () => 'Stop 1 tick beyond the swing point that defines the trendline break',
    invalidation: () => 'Void if price closes back across the trendline',
  },
  {
    id: 'gap',
    label: 'Gap',
    specificity: 6,
    patterns: [/\bgap (fill|up|down|and go)|gaps? (up|down)|\bgap\b/i],
    name: () => 'Gap',
  },
  {
    id: 'range',
    label: 'Range / Balance',
    specificity: 4,
    patterns: [/range[- ]bound|\bbalance\b|inside day|\bchop(py)?\b/i],
  },
  {
    id: 'indicator',
    label: 'Indicator-based',
    specificity: 5,
    patterns: [/\bRSI\b|\bMACD\b|stochastic|divergence|bollinger/i],
    name: () => 'Indicator',
  },
  {
    id: 'fibonacci',
    label: 'Fibonacci',
    specificity: 6,
    patterns: [/\bfib(onacci)?\b|61\.8|golden pocket/i],
    name: () => 'Fib',
  },
  {
    id: 'scalping',
    label: 'Scalping',
    specificity: 3,
    patterns: [/\bscalp(s|ing|er)?\b/i],
  },
  {
    id: 'news',
    label: 'News / Event',
    specificity: 5,
    patterns: [/\bnews\b.*\btrade\b|\btrade\b.*\b(news|CPI|FOMC|NFP)\b/i],
  },
];

export const CUSTOM_STYLE = { id: 'custom', label: 'Other / Custom' } as const;

export function abbreviateLevel(level: string): string {
  const l = level.toLowerCase();
  if (/(previous|prior|yesterday).*high/.test(l)) return 'PDH';
  if (/(previous|prior|yesterday).*low/.test(l)) return 'PDL';
  if (/overnight high|globex high/.test(l)) return 'ONH';
  if (/overnight low|globex low/.test(l)) return 'ONL';
  return level.replace(/\b\w/g, (m) => m.toUpperCase());
}

export function conceptById(id: string): Concept | undefined {
  return CONCEPTS.find((c) => c.id === id);
}
