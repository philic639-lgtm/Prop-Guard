import type { MarketRegime, StrategyStyleId } from './types';

/**
 * Trading concepts Prop Guard recognizes in free text. This is a vocabulary,
 * NOT a list of allowed strategies: a description can match any combination
 * of concepts, or none — then it is classified "Other / Custom" and analysed
 * from its own words. No concept supplies default parameters. Knowledge here
 * interprets terms the trader used, explains the idea behind them, and words
 * suggestions in the trader's own vocabulary (tools such as VWAP or an EMA are
 * only mentioned when the trader already uses them).
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
  /** Concept ids detected in the trader's text. */
  concepts: string[];
  /** All timeframes the trader mentioned, smallest first. */
  timeframes?: string[];
}

type Txt = (c: ConceptContext) => string;

export interface ConceptKnowledge {
  inferred?: (c: ConceptContext) => string[];
  name?: Txt;
  stop?: Txt;
  target?: Txt;
  invalidation?: Txt;
  entry?: Txt;
  noTrade?: Txt;
  /** The market behavior this idea tries to exploit. */
  thesis?: Txt;
  /** What must be true for it to work. */
  assumption?: Txt;
  falseSignals?: string[];
  early?: string;
  late?: string;
  regimes?: { good: [MarketRegime, string][]; avoid: [MarketRegime, string][] };
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
const uses = (c: ConceptContext, id: string) => c.concepts.includes(id);
const TF_ORDER = ['tick', '1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '1D'];
const tfName = (t: string) => (t === '1D' ? 'daily' : t.replace(/m$/, '-minute').replace(/h$/, '-hour'));
const sortedTf = (c: ConceptContext) => [...(c.timeframes ?? [])].sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));
/** Highest timeframe the trader named (the bias chart). */
const htf = (c: ConceptContext) => (sortedTf(c).length ? tfName(sortedTf(c)[sortedTf(c).length - 1]) : 'higher-timeframe');
/** The structure timeframe between bias and execution, when there is one. */
const midTf = (c: ConceptContext) => (sortedTf(c).length >= 3 ? tfName(sortedTf(c)[sortedTf(c).length - 2]) : htf(c));
const ma = (c: ConceptContext) => (c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'moving average');

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
    noTrade: () => 'Skip if the opening range is wider than 2× your maximum stop (the stop would not fit the plan)',
    thesis: () => 'Early-session order imbalance: once price accepts outside the first range, the session tends to extend in that direction.',
    assumption: () => 'Acceptance outside the range (a close, then a hold on retest) signals real participation rather than a stop run.',
    falseSignals: ['Breakout candles that close outside and immediately reverse back into the range (failed auction)', 'Wide opening ranges where the breakout level is already near the day’s typical extreme'],
    early: 'Entering on the first push through the range high/low before a candle closes outside it.',
    late: 'Entering after the measured move is mostly done, or on a third or fourth retest.',
    regimes: {
      good: [
        ['opening_session', 'It is built on the first minutes of the session.'],
        ['breakout', 'It needs price to leave the opening balance.'],
        ['trending', 'Trend days extend away from the opening range.'],
      ],
      avoid: [
        ['ranging', 'Inside / balance days rotate back through the range, producing failed breakouts.'],
        ['news_driven', 'Scheduled news inside the window can whip both sides of the range.'],
      ],
    },
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
    thesis: () => 'One-sided initiative order flow at the open that does not look back.',
    assumption: () => 'The first move of the session reflects real repositioning, not just overnight inventory being unwound.',
    falseSignals: ['Open drives that stall at the overnight high/low and reverse', 'Drives driven only by a gap fill'],
    early: 'Joining the drive in the first minute before any pullback structure exists.',
    late: 'Chasing after the drive has already moved several average candle ranges without a pause.',
    regimes: {
      good: [
        ['opening_session', 'Only exists in the first minutes after the open.'],
        ['trending', 'Drive days usually become trend days.'],
        ['high_volatility', 'Needs range expansion at the open.'],
      ],
      avoid: [
        ['ranging', 'Rotational opens fade the first move.'],
        ['low_volatility', 'Quiet opens rarely produce a true drive.'],
      ],
    },
  },
  {
    id: 'liquidity_sweep',
    label: 'Liquidity Sweep',
    specificity: 9,
    patterns: [/\bsweep(s|ing|ed)?\b/i, /stop (hunt|run)/i, /liquidity (grab|raid|sweep)/i, /takes? out (the )?(low|high|stops)/i, /\bspring\b|\bupthrust\b/i],
    inferred: (c) => [`Sweep = price trades beyond ${c.level ?? 'the reference level'} and then closes back on the other side of it`],
    name: (c) => `${c.level ? `${abbreviateLevel(c.level)} ` : ''}Sweep`,
    stop: (c) => side(c, '1 tick below the low of the sweep', '1 tick above the high of the sweep', '1 tick beyond the sweep extreme'),
    target: (c) => (uses(c, 'vwap') ? 'First target at VWAP or 2R, whichever is closer' : `First target at the last swing ${side(c, 'high', 'low', 'point')} before the sweep, or 2R, whichever is closer`),
    invalidation: (c) => `Void if a ${tf(c)} candle closes back beyond ${c.level ?? 'the swept level'} after entry`,
    entry: (c) => `Enter on the first ${tf(c)} candle close back ${side(c, 'above', 'below', 'inside')} ${c.level ?? 'the swept level'}`,
    thesis: (c) => `Stops resting beyond ${c.level ?? 'an obvious level'} get triggered; once that liquidity is taken and price reclaims the level, the move beyond was a trap.`,
    assumption: (c) => `The move through ${c.level ?? 'the level'} was fuelled by stops, not by new participants who will keep pushing.`,
    falseSignals: ['A sweep that is actually the start of a breakdown/breakout — price reclaims briefly, then continues', 'Multiple sweeps of the same level in one session (the level stops meaning anything)'],
    early: 'Buying/selling while price is still beyond the level, before it closes back on the other side.',
    late: 'Entering after the reclaim has already run most of the way to the first target.',
    regimes: {
      good: [
        ['mean_reversion', 'It bets the excursion beyond the level reverses.'],
        ['ranging', 'Range edges are where stops cluster and get swept.'],
        ['high_volatility', 'Sweeps need a fast push through the level.'],
      ],
      avoid: [
        ['trending', 'In strong trends, a level that breaks usually stays broken.'],
        ['news_driven', 'News spikes sweep levels for reasons that do not reverse.'],
      ],
    },
  },
  {
    id: 'order_flow',
    label: 'Order Flow',
    specificity: 9,
    patterns: [/footprint/i, /order ?flow/i, /\bdelta\b/i, /\bDOM\b|depth of market|\btape\b/i, /imbalance/i, /iceberg/i, /aggressive (buyers|sellers)/i],
    inferred: () => ['Signals are read from footprint / order-flow data at the level (not from candles alone)'],
    name: () => 'Order Flow',
    stop: (c) => side(c, '2 ticks below the absorption low', '2 ticks above the absorption high', '2 ticks beyond the absorption extreme'),
    target: () => 'First target at the next level where volume previously built up, or 2R, whichever is closer',
    invalidation: () => 'Void if price trades through the absorption level with continued aggressive volume',
    thesis: () => 'Passive limit orders at a level absorb aggressive market orders; when aggression stops making progress, the other side takes over.',
    assumption: () => 'The footprint shows real resting liquidity, not orders that will be pulled before price arrives.',
    falseSignals: ['Absorption that is only a pause before the level breaks (iceberg is exhausted)', 'Signals on thin, low-volume bars where delta is noise'],
    early: 'Entering while aggression is still hitting the level and price has not yet stopped making new extremes.',
    late: 'Waiting for a full candle close on a higher timeframe after the order-flow signal, giving up most of the edge.',
    regimes: {
      good: [
        ['mean_reversion', 'Absorption is a turn signal at a level.'],
        ['high_volatility', 'Needs enough participation for the footprint to be meaningful.'],
        ['opening_session', 'Order flow is most readable when volume is highest.'],
      ],
      avoid: [
        ['low_volatility', 'Thin markets produce footprint noise.'],
        ['news_driven', 'Order flow during releases is dominated by algorithms and gaps.'],
      ],
    },
  },
  {
    id: 'absorption',
    label: 'Absorption',
    specificity: 9,
    patterns: [/absorb(s|ed|ing)?\b|absorption/i],
    inferred: (c) => [`Absorption = heavy ${side(c, 'selling', 'buying', 'aggressive')} volume trades into the level while price fails to move through it`],
    name: () => 'Absorption',
  },
  {
    id: 'mean_reversion',
    label: 'Mean Reversion',
    specificity: 8,
    patterns: [/\bfade(s|d|ing)?\b/i, /stretched|over-?extended|too far (from|away)|far (away )?from/i, /mean[- ]revert|mean reversion|snap ?back|back to (the )?(mean|vwap|average)/i],
    name: () => 'Mean Reversion',
    stop: () => 'Stop 1 tick beyond the extreme of the stretch (the high/low made before the turn)',
    target: (c) => (uses(c, 'vwap') ? 'Target a return to VWAP, with a minimum of 1.5R' : uses(c, 'moving_average') ? `Target a return to the ${ma(c)}, with a minimum of 1.5R` : 'Target a return to the level price stretched away from, with a minimum of 1.5R'),
    invalidation: (c) => `Void if price makes a new extreme with a ${tf(c)} candle close beyond the stretch high/low`,
    noTrade: (c) => (uses(c, 'vwap') ? 'Do not fade on trend days (price has not touched VWAP since the first 30 minutes)' : 'Do not fade on trend days (no pullback of more than 2 average candle ranges since the open)'),
    thesis: () => 'Over-extension: price that moves too far, too fast tends to snap back toward its average.',
    assumption: () => 'The market is rotating around a fair value today, so distance from it is temporary.',
    falseSignals: ['Trend days, where “stretched” keeps getting more stretched', 'Fading the first leg of a news-driven repricing'],
    early: 'Fading while the stretch is still accelerating (no slowdown candle yet).',
    late: 'Entering after price is already half-way back to the mean, leaving little reward for the stop.',
    regimes: {
      good: [
        ['ranging', 'Rotational days return to the mean repeatedly.'],
        ['mean_reversion', 'It is a reversion idea by design.'],
        ['late_session', 'Mid/late-session extensions often revert as volume fades.'],
      ],
      avoid: [
        ['trending', 'Trend days never return to the mean — fades get run over.'],
        ['news_driven', 'News re-prices fair value, so the old mean no longer applies.'],
        ['breakout', 'Breakouts are the opposite bet.'],
      ],
    },
  },
  {
    id: 'vwap',
    label: 'VWAP',
    specificity: 7,
    patterns: [/\bvwap\b/i],
    inferred: () => ['VWAP = session VWAP anchored at the 9:30 ET regular-session open'],
    name: () => 'VWAP',
    thesis: () => 'VWAP is where the session’s volume traded on average — institutions benchmark against it.',
    assumption: () => 'Participants defend or return to VWAP during the session.',
  },
  {
    id: 'moving_average',
    label: 'Moving Average',
    specificity: 7,
    patterns: [/\b\d+\s*-?\s*(ema|sma|ma)\b/i, /moving average/i, /\b(ema|sma)\s*\d+\b/i],
    inferred: (c) => [`${c.emaPeriod ? `${c.emaPeriod}-period ${c.emaType ?? 'EMA'}` : 'Moving average'} ${c.timeframe ? `on the ${tf(c)} chart` : 'on your execution chart (timeframe not stated)'}`],
    name: (c) => `${c.emaPeriod ? `${c.emaPeriod} ${c.emaType ?? 'EMA'}` : 'MA'}`,
    stop: (c) => side(c, '1 tick below the pullback swing low', '1 tick above the pullback swing high', '1 tick beyond the pullback swing point'),
    target: () => 'First target at the prior swing high/low in the trend direction, minimum 2R',
    invalidation: (c) => `Void if a ${tf(c)} candle closes on the far side of the ${ma(c)} before entry`,
    entry: (c) => `Enter on the first ${tf(c)} candle that touches the ${ma(c)} and closes back in the trend direction`,
    thesis: (c) => `In a trend, pullbacks to the ${ma(c)} are where trend followers re-enter.`,
    assumption: (c) => `The ${ma(c)} is acting as dynamic support/resistance in the current trend.`,
    falseSignals: ['Touches during a trend that is already rolling over (the average flattens)', 'Choppy price that crosses the average repeatedly'],
    early: 'Buying the first touch while price is still falling hard into the average.',
    late: 'Entering after price has already bounced well away from the average.',
    regimes: {
      good: [['trending', 'Pullbacks only work while the trend holds.']],
      avoid: [
        ['ranging', 'Price crosses the average back and forth in ranges.'],
        ['low_volatility', 'Tiny pullbacks give no room for a stop below the swing.'],
      ],
    },
  },
  {
    id: 'pdh_pdl',
    label: 'Previous Day High/Low',
    specificity: 7,
    patterns: [/previous day'?s? (high|low)|prior day'?s? (high|low)|yesterday'?s? (high|low)|\bPDH\b|\bPDL\b/i],
    inferred: () => ['Previous day high/low = prior regular-session (9:30–16:00 ET) extremes'],
    thesis: () => 'Yesterday’s extremes are widely watched reference levels where orders cluster.',
    assumption: () => 'Enough participants act at the prior day’s high/low for it to matter today.',
  },
  {
    id: 'retest',
    label: 'Breakout + Retest',
    specificity: 6,
    patterns: [/re-?test/i],
    name: () => 'Retest',
    entry: (c) => `Enter when the retest holds: a ${tf(c)} candle touches the broken level and closes back in the breakout direction`,
    late: 'Waiting for a retest that never comes, then chasing after the move has left.',
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
    thesis: () => 'A level that has held several times is where orders cluster; once it gives way, trapped traders and new entries push price through.',
    assumption: () => 'The break is backed by new participation and will not immediately be absorbed.',
    falseSignals: ['Wicks through the level that close back inside', 'Breakouts late in the day with falling volume'],
    early: 'Entering on the first tick through the level instead of a close beyond it.',
    late: 'Entering several candles after the break, with the stop now far away.',
    regimes: {
      good: [
        ['breakout', 'It needs range expansion.'],
        ['trending', 'Trending days follow through after breaks.'],
        ['high_volatility', 'Breakouts need enough movement to reach target.'],
      ],
      avoid: [
        ['ranging', 'Range days fade breakouts back inside.'],
        ['low_volatility', 'Quiet markets produce false breaks that stall.'],
      ],
    },
  },
  {
    id: 'reversal',
    label: 'Reversal',
    specificity: 5,
    patterns: [/revers(al|es|e|ing)/i, /closes? back (above|below|inside)/i, /reclaim/i, /fail(ed|ure)? (break(out|down)|auction)/i, /v[- ]?(bottom|top)/i],
    name: () => 'Reversal',
    stop: (c) => side(c, '1 tick below the reversal low', '1 tick above the reversal high', '1 tick beyond the reversal extreme'),
    target: () => 'First target at 2R or the start of the move that reversed, whichever is closer',
    invalidation: () => 'Void if price makes a new extreme beyond the reversal point',
    thesis: () => 'Exhaustion: the move runs out of new participants and trapped traders exit in the other direction.',
    assumption: () => 'The prior move was overextended or stop-driven rather than a re-pricing.',
    falseSignals: ['Bounces inside a strong trend that resume the trend (bull/bear flags)'],
    early: 'Calling the turn before price closes back across the reversal level.',
    regimes: {
      good: [
        ['mean_reversion', 'Reversals bet on a return.'],
        ['high_volatility', 'Needs a sharp prior move to reverse.'],
      ],
      avoid: [['trending', 'Counter-trend in a strong trend is the most common way this fails.']],
    },
  },
  {
    id: 'trend_continuation',
    label: 'Trend Continuation',
    specificity: 5,
    patterns: [/\btrend(s|ing)?\b(?!\s*line)/i, /continuation/i, /with the trend/i, /higher highs? and higher lows?|lower highs? and lower lows?/i],
    name: () => 'Trend',
    stop: (c) => side(c, '1 tick below the most recent higher low', '1 tick above the most recent lower high', '1 tick beyond the most recent swing point'),
    target: () => 'First target at the prior trend extreme, minimum 2R',
    invalidation: () => 'Void if the trend structure breaks (a lower low in an uptrend / higher high in a downtrend)',
    thesis: () => 'Trends persist: participants who missed the first move join on pullbacks.',
    assumption: () => 'The trend is established and has not yet exhausted.',
    falseSignals: ['Late-stage trends that are about to reverse', 'Trends defined on a timeframe too short to persist'],
    regimes: {
      good: [['trending', 'It is a trend strategy.']],
      avoid: [['ranging', 'No trend — no continuation.']],
    },
  },
  {
    id: 'pullback',
    label: 'Pullback',
    specificity: 5,
    patterns: [/pull ?backs?|retrace(ment|s)?|\bdips?\b/i],
    name: () => 'Pullback',
    late: 'Waiting for a deeper pullback that never comes and missing the trend leg.',
  },
  {
    id: 'support_resistance',
    label: 'Support / Resistance',
    specificity: 4,
    patterns: [/\bsupport\b|\bresistance\b|key levels?/i],
    stop: (c) => side(c, '2 ticks below the support level', '2 ticks above the resistance level', '2 ticks beyond the level'),
    target: () => 'Target the next opposing level, minimum 2R',
    invalidation: (c) => `Void if a ${tf(c)} candle closes through the level`,
    thesis: () => 'Levels where price turned before still hold resting orders.',
    assumption: () => 'The level is visible to enough participants to still attract orders.',
    falseSignals: ['Levels that have been tested many times (the orders are used up)'],
    regimes: {
      good: [['ranging', 'Ranges are defined by support and resistance.']],
      avoid: [['trending', 'Trends break through levels.']],
    },
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
    thesis: () => 'Zones where price left quickly contain unfilled orders that react on return.',
    assumption: () => 'The original orders in the zone are still unfilled.',
    regimes: { good: [['ranging', 'Zones work best when price rotates.']], avoid: [['news_driven', 'News re-prices zones.']] },
  },
  {
    id: 'market_structure',
    label: 'Market Structure',
    specificity: 6,
    patterns: [/break of structure|\bBOS\b|\bCHoCH\b|market structure|change of character/i],
    name: () => 'Structure',
    thesis: () => 'A break of the swing structure marks a change in who controls the market.',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    specificity: 3,
    patterns: [/momentum/i, /impulse|explosive|thrust/i],
    thesis: () => 'Strong moves attract followers and tend to extend in the short term.',
    regimes: { good: [['high_volatility', 'Momentum needs movement.']], avoid: [['low_volatility', 'No momentum in quiet markets.']] },
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
    thesis: () => 'A trendline break signals the trend’s pace has changed.',
  },
  {
    id: 'gap',
    label: 'Gap',
    specificity: 6,
    patterns: [/\bgap (fill|up|down|and go)|gaps? (up|down)|\bgap\b/i],
    name: () => 'Gap',
    thesis: () => 'Overnight gaps either fill (inventory correction) or extend (new information).',
    regimes: { good: [['opening_session', 'Gaps are resolved early in the session.']], avoid: [['news_driven', 'News gaps behave differently from inventory gaps.']] },
  },
  {
    id: 'range',
    label: 'Range / Balance',
    // A trader who names the range is describing a range strategy: its wording outranks generic mean reversion.
    specificity: 8.5,
    patterns: [/range[- ]bound|\bbalance\b|inside day|\bchop(py)?\b|\brange (fade|edge|high|low|top|bottom)|\bfade the range|\bthe range\b/i],
    name: () => 'Range',
    stop: (c) => side(c, '2 ticks below the range low', '2 ticks above the range high', '2 ticks beyond the range edge'),
    target: () => 'Target the middle of the range first, the opposite edge second',
    invalidation: (c) => `Void if a ${tf(c)} candle closes outside the range`,
    thesis: () => 'Balance: buyers and sellers agree on value, so price rotates between the range edges.',
    assumption: () => 'The range stays intact — no new information forces a breakout.',
    falseSignals: ['The edge touch that turns into the breakout', 'Ranges that are too narrow for stop + target to fit'],
    early: 'Fading before price actually reaches the range edge.',
    regimes: {
      good: [
        ['ranging', 'It only works while the range holds.'],
        ['low_volatility', 'Quiet markets respect range edges.'],
      ],
      avoid: [
        ['trending', 'Trend days break ranges.'],
        ['breakout', 'Range expansion invalidates the idea.'],
        ['news_driven', 'News breaks ranges.'],
      ],
    },
  },
  {
    id: 'indicator',
    label: 'Indicator-based',
    specificity: 5,
    patterns: [/\bRSI\b|\bMACD\b|stochastic|divergence|bollinger/i],
    name: (c) => (/\bRSI\b/i.test(c.text) ? (/divergen/i.test(c.text) ? 'RSI Divergence' : 'RSI') : /MACD/i.test(c.text) ? 'MACD' : 'Indicator'),
    stop: (c) => side(c, '1 tick below the swing low that formed the divergence', '1 tick above the swing high that formed the divergence', '1 tick beyond the divergence swing'),
    target: () => 'First target at the start of the last swing (the divergence high/low), minimum 1.5R',
    invalidation: () => 'Void if price makes a further extreme beyond the divergence swing before entry',
    entry: (c) => `Enter on the first ${tf(c)} candle that closes beyond the high (low) of the divergence swing candle`,
    thesis: () => 'Divergence: price makes a new extreme while momentum does not — the move is losing force.',
    assumption: () => 'Fading momentum leads to a reversal rather than a pause.',
    falseSignals: ['Repeated divergences in a strong trend (divergence can persist for many swings)'],
    early: 'Entering on the divergence alone, before price confirms the turn.',
    regimes: {
      good: [
        ['mean_reversion', 'Divergence is a reversal signal.'],
        ['ranging', 'Momentum oscillators work best in rotation.'],
      ],
      avoid: [['trending', 'Divergences keep failing in strong trends.']],
    },
  },
  {
    id: 'multi_timeframe',
    label: 'Multi-Timeframe',
    specificity: 6,
    patterns: [/higher[- ]time ?frame|\bHTF\b|multi[- ]time ?frame|lower time ?frame/i, /(?:daily|weekly|4\s?-?h(?:our)?|1\s?-?h(?:our)?|hourly) (?:trend|bias|chart|structure)[^.]*\b\d+\s*-?\s*(?:min(?:ute)?s?|m)\b/i],
    name: () => 'Multi-Timeframe Trend',
    entry: (c) => `Enter on the first ${tf(c)} close beyond the last ${tf(c)} swing in the direction of the ${htf(c)} trend`,
    stop: (c) => side(c, `Stop 1 tick below the ${tf(c)} swing low that formed before the break`, `Stop 1 tick above the ${tf(c)} swing high that formed before the break`, `Stop 1 tick beyond the ${tf(c)} swing that formed before the break`),
    target: (c) => `First target at the last ${midTf(c)} swing extreme in the trend direction, minimum 2R`,
    invalidation: (c) => `Void if the ${midTf(c)} structure breaks against the ${htf(c)} trend before entry`,
    noTrade: (c) => `Do not trade when the ${htf(c)} and ${midTf(c)} trends disagree`,
    thesis: () => 'Aligning a lower-timeframe entry with the higher-timeframe direction trades with the larger flow.',
    assumption: () => 'The higher-timeframe trend persists for the duration of the trade.',
    falseSignals: ['Higher-timeframe trend that is ending (late-stage alignment)'],
    late: 'Waiting for every timeframe to align, which often happens after the move.',
    regimes: { good: [['trending', 'Alignment needs a higher-timeframe trend.']], avoid: [['ranging', 'No higher-timeframe direction to align with.']] },
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
    thesis: () => 'Small, frequent moves around short-term order imbalances.',
    falseSignals: ['Spread and commission eating a large share of each small target'],
    regimes: {
      good: [
        ['high_volatility', 'Scalps need movement.'],
        ['opening_session', 'Highest liquidity and movement.'],
      ],
      avoid: [['low_volatility', 'Not enough movement to cover costs.']],
    },
  },
  {
    id: 'news',
    label: 'News / Event',
    specificity: 5,
    patterns: [/\bnews\b.*\btrade\b|\btrade\b.*\b(news|CPI|FOMC|NFP)\b/i],
    regimes: { good: [['news_driven', 'Built around events.']], avoid: [] },
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

export const REGIME_LABELS: Record<MarketRegime, string> = {
  trending: 'Trending',
  ranging: 'Ranging',
  high_volatility: 'High volatility',
  low_volatility: 'Low volatility',
  breakout: 'Breakout',
  mean_reversion: 'Mean reversion',
  news_driven: 'News-driven',
  opening_session: 'Opening session',
  late_session: 'Late session',
};

/** Concept ids whose patterns appear in a piece of text (used to classify templates and other strategies). */
export function conceptIdsIn(text: string): string[] {
  return CONCEPTS.filter((c) => c.patterns.some((p) => p.test(text))).map((c) => c.id);
}
