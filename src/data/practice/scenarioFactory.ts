import { getTemplate } from '@/data/strategyLibrary';
import { getInstrument, roundToTick } from '@/lib/engines/instrumentEngine';
import { simulatePracticeTrade } from '@/lib/engines/practiceScoringEngine';
import type { PracticeCandle, PracticeDecision, PracticeDifficulty, PracticeLevel, PracticeScenario, PracticeSession } from '@/types/practice';

/**
 * Builds EDUCATIONAL SAMPLE scenarios from hand-designed price patterns.
 *
 * Patterns are drawn in abstract "units" (long orientation) and scaled to each
 * instrument's typical intraday range, then rounded to its tick size. They are
 * illustrations of how setups commonly unfold — NOT recorded market history —
 * and every scenario says so in `source`. A real market-data provider can
 * replace this module behind the ScenarioProvider interface.
 */

type U = [o: number, h: number, l: number, c: number];

interface Archetype {
  strategyId: string;
  candles: U[];
  decisionIndex: number;
  levels: { label: string; units: number; kind: PracticeLevel['kind'] }[];
  vwap?: number[];
  openingRange?: { from: number; to: number; high: number; low: number };
  idealDecision: 'trade' | 'wait';
  /** Ideal trade in units (long orientation). Target derives from the template's default R:R. */
  ideal?: { entry: number; stop: number; zone: [number, number] };
  bias: 'with' | 'neutral' | 'against';
  trend: 'with' | 'range';
  volatility: 'low' | 'normal' | 'high';
  characteristics: PracticeScenario['setupCharacteristics'];
  explanation: (lvl: string, dir: Dir) => string[];
  lesson: string;
  commonMistake: string;
  badges?: string[];
}

type Dir = 'long' | 'short';

// ───────────────────────── Pattern library (long orientation, units) ─────────────────────────

const ORB_LEAD: U[] = [
  [0, 4, -1, 3],
  [3, 6, 2, 2.5],
  [2.5, 5.5, 0, 4.5],
];
const ORB_RANGE = { from: 0, to: 2, high: 6, low: -1 };

const ARCHETYPES: Record<string, Archetype> = {
  orb_first_retest: {
    strategyId: 'orb-15',
    candles: [...ORB_LEAD, [4.5, 9, 4, 8.5], [8.5, 10, 7.5, 8], [8, 8.5, 6.25, 6.75], [6.75, 9.5, 6.5, 9.25], [9.25, 11, 8.75, 10.5], [10.5, 13, 10, 12.5], [12.5, 14, 11.5, 13], [13, 16, 12.75, 15.5], [15.5, 17.75, 15, 17.25], [17.25, 18, 16, 16.5], [16.5, 17, 15, 15.5]],
    decisionIndex: 6,
    levels: [
      { label: 'OR High', units: 6, kind: 'orb_high' },
      { label: 'OR Low', units: -1, kind: 'orb_low' },
    ],
    openingRange: ORB_RANGE,
    idealDecision: 'trade',
    ideal: { entry: 9.25, stop: 5.75, zone: [8.5, 9.75] },
    bias: 'with',
    trend: 'with',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: true, breakoutStrength: 'strong', entryQuality: 'ideal' },
    explanation: (l, d) => [
      `A 5-minute candle closed decisively ${d === 'long' ? 'above' : 'below'} the ${l} after the 15-minute range formed.`,
      `Price came back for the FIRST retest of the broken ${l} and held it.`,
      `The hold candle closed back in the breakout direction, aligned with the higher-timeframe bias.`,
      'A stop beyond the retest wick gives a defined risk with room for a 1:2 target.',
    ],
    lesson: 'The cleanest ORB continuation setups usually come from the FIRST retest that holds the broken opening-range level.',
    commonMistake: 'Chasing the breakout candle itself instead of waiting for the retest.',
    badges: ['A+ EXAMPLE', 'FIRST RETEST', 'TREND ALIGNED', 'CLEAN BREAKOUT', 'STRONG R:R'],
  },
  orb_third_retest: {
    strategyId: 'orb-15',
    candles: [...ORB_LEAD, [4.5, 7.25, 4.25, 7], [7, 8, 5.75, 6.25], [6.25, 7.75, 5.5, 7.25], [7.25, 8.25, 6, 6.5], [6.5, 7.5, 5.75, 7.25], [7.25, 7.75, 4.5, 5], [5, 5.5, 2, 2.5], [2.5, 4, 1.5, 3.5], [3.5, 4, 0.5, 1], [1, 2.5, 0, 2]],
    decisionIndex: 7,
    levels: [
      { label: 'OR High', units: 6, kind: 'orb_high' },
      { label: 'OR Low', units: -1, kind: 'orb_low' },
    ],
    openingRange: ORB_RANGE,
    idealDecision: 'wait',
    bias: 'neutral',
    trend: 'range',
    volatility: 'normal',
    characteristics: { retestNumber: 3, firstRetest: false, trendAligned: false, breakoutStrength: 'weak', entryQuality: 'late' },
    explanation: (l) => [
      `The breakout above the ${l} was weak — the close barely cleared the level.`,
      `This is the THIRD test of the ${l}; each retest dipped back inside the range.`,
      'The higher-timeframe bias was neutral, so there was no trend support behind the breakout.',
      'Repeated retests show the level is being absorbed, not respected — the plan says WAIT.',
    ],
    lesson: 'Each additional retest weakens a breakout. By the third test that dips back inside the range, the setup no longer meets the rules.',
    commonMistake: 'Buying the third retest because "it held before" — repeated tests often precede a failure.',
  },
  orb_failed: {
    strategyId: 'orb-15',
    candles: [...ORB_LEAD, [4.5, 7.5, 4, 7], [7, 7.5, 4.5, 5], [5, 5.75, 3, 3.5], [3.5, 4.5, 1, 1.5], [1.5, 3, 0.5, 2.5], [2.5, 3.5, 1.5, 2], [2, 2.5, -0.5, 0], [0, 1.5, -1, 1], [1, 2, 0, 1.75]],
    decisionIndex: 4,
    levels: [
      { label: 'OR High', units: 6, kind: 'orb_high' },
      { label: 'OR Low', units: -1, kind: 'orb_low' },
    ],
    openingRange: ORB_RANGE,
    idealDecision: 'wait',
    bias: 'neutral',
    trend: 'range',
    volatility: 'normal',
    characteristics: { retestNumber: 0, firstRetest: false, trendAligned: false, breakoutStrength: 'weak' },
    explanation: (l) => [
      `Price closed above the ${l}, but the very next candle closed back inside the opening range.`,
      'A close back inside means the breakout was not accepted.',
      'There was no retest that held — the ORB retest rules were never met.',
    ],
    lesson: 'A breakout that closes back inside the opening range is not a retest — it is a failed breakout. The ORB retest plan says stand aside.',
    commonMistake: 'Treating the move back to the level as a "retest" even though it closed back inside the range.',
  },
  trend_pullback: {
    strategyId: 'trend-pullback',
    candles: [[0, 3, -0.5, 2.5], [2.5, 5, 2, 4.5], [4.5, 7.5, 4, 7], [7, 9, 6.5, 8.5], [8.5, 9, 6, 6.5], [6.5, 7, 5, 5.5], [5.5, 8.5, 5.25, 8], [8, 10, 7.5, 9.5], [9.5, 12, 9, 11.5], [11.5, 14, 11, 13.5], [13.5, 15.5, 13, 14.5], [14.5, 15, 12.5, 13]],
    decisionIndex: 6,
    levels: [{ label: 'Prior swing high', units: 7.5, kind: 'resistance' }],
    vwap: [0.5, 1.5, 2.5, 3.5, 4.25, 4.75, 5, 5.5, 6, 6.75, 7.5, 8],
    idealDecision: 'trade',
    ideal: { entry: 8, stop: 4.5, zone: [7.25, 8.5] },
    bias: 'with',
    trend: 'with',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: true, breakoutStrength: 'normal', entryQuality: 'ideal' },
    explanation: (_l, d) => [
      `The session was trending ${d === 'long' ? 'up' : 'down'} with higher-timeframe agreement.`,
      'Price made an orderly pullback into VWAP / prior structure and held.',
      'A confirmation candle closed back in the trend direction before entry.',
      'The stop sits beyond the pullback swing — the point where the trend would be wrong.',
    ],
    lesson: 'Trend pullbacks work best when the pullback is orderly and holds structure, followed by a candle that closes back with the trend.',
    commonMistake: 'Entering while the pullback is still falling, before any confirmation candle.',
    badges: ['A+ EXAMPLE', 'TREND ALIGNED', 'STRONG R:R'],
  },
  trend_pullback_fail: {
    strategyId: 'trend-pullback',
    candles: [[0, 3, -0.5, 2.5], [2.5, 5, 2, 4.5], [4.5, 7.5, 4, 7], [7, 9, 6.5, 8.5], [8.5, 9, 6, 6.5], [6.5, 7, 3.5, 4], [4, 5.5, 3.25, 5], [5, 5.5, 2, 2.5], [2.5, 3, 0, 0.5], [0.5, 1.5, -1.5, -1], [-1, 0.5, -2, 0], [0, 1, -1, 0.5]],
    decisionIndex: 6,
    levels: [{ label: 'Prior swing high', units: 7.5, kind: 'resistance' }],
    vwap: [0.5, 1.5, 2.5, 3.5, 4.25, 4.75, 4.75, 4.5, 4.25, 4, 3.75, 3.5],
    idealDecision: 'wait',
    bias: 'with',
    trend: 'range',
    volatility: 'normal',
    characteristics: { trendAligned: true, breakoutStrength: 'weak' },
    explanation: () => [
      'The pullback did not hold — it closed decisively through VWAP and the prior swing.',
      'The bounce candle was weak and closed below VWAP.',
      'A pullback that breaks structure is the trend failing, not a buying opportunity.',
    ],
    lesson: 'A trend pullback is only valid while structure holds. A close through VWAP / the last swing cancels the setup.',
    commonMistake: 'Buying the first green candle after a pullback that has already broken structure.',
  },
  vwap_reclaim: {
    strategyId: 'vwap-reclaim',
    candles: [[6, 6.5, 3, 3.5], [3.5, 4, 1.5, 2], [2, 3.5, 1, 3], [3, 6.5, 2.75, 6.25], [6.25, 7, 5, 5.5], [5.5, 8, 5.25, 7.75], [7.75, 9, 7.25, 8.75], [8.75, 10.5, 8.5, 10], [10, 12, 9.75, 11.75], [11.75, 14.5, 11.25, 14], [14, 14.25, 12, 12.5]],
    decisionIndex: 5,
    levels: [],
    vwap: [6, 5.75, 5.5, 5.25, 5.25, 5.25, 5.25, 5.5, 5.75, 6, 6.25],
    idealDecision: 'trade',
    ideal: { entry: 7.75, stop: 4.5, zone: [7, 8.25] },
    bias: 'with',
    trend: 'with',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: true, breakoutStrength: 'strong', entryQuality: 'ideal' },
    explanation: (_l, d) => [
      `Price had been trading ${d === 'long' ? 'below' : 'above'} VWAP, then reclaimed it with a strong 5-minute close.`,
      'The first retest of VWAP held on a closing basis.',
      'The confirmation candle closed away from VWAP in the reclaim direction.',
    ],
    lesson: 'A VWAP reclaim is confirmed by the retest: VWAP flipping from resistance to support (or the reverse) is the signal.',
    commonMistake: 'Entering on the reclaim candle before VWAP has been retested.',
    badges: ['FIRST RETEST', 'CLEAN BREAKOUT'],
  },
  vwap_reclaim_fail: {
    strategyId: 'vwap-reclaim',
    candles: [[6, 6.5, 3, 3.5], [3.5, 4, 1.5, 2], [2, 3.5, 1, 3], [3, 6.5, 2.75, 6.25], [6.25, 6.5, 3.75, 4], [4, 4.5, 2, 2.25], [2.25, 3, 0.5, 1], [1, 2, -0.5, 0], [0, 1.25, -1, 1], [1, 1.5, -1.5, -1], [-1, 0, -2, -0.5]],
    decisionIndex: 4,
    levels: [],
    vwap: [6, 5.75, 5.5, 5.25, 5.25, 5, 4.75, 4.5, 4.25, 4, 3.75],
    idealDecision: 'wait',
    bias: 'neutral',
    trend: 'range',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: false, breakoutStrength: 'weak' },
    explanation: () => [
      'Price closed back above VWAP, but the retest failed — the next candle closed back below it.',
      'A reclaim that does not hold on the retest is not a reclaim.',
      'The VWAP reclaim plan requires the retest to hold before entry.',
    ],
    lesson: 'The retest is the confirmation. If VWAP does not hold on the retest, there is no trade.',
    commonMistake: 'Entering because price crossed VWAP, without waiting to see if it holds.',
  },
  sweep_reversal: {
    strategyId: 'liquidity-sweep',
    // Long orientation = sweep of a swing LOW, then reversal up.
    candles: [[8, 8.5, 4, 4.5], [4.5, 5, 0, 1], [1, 4, 0.5, 3.5], [3.5, 4.5, 2, 2.5], [2.5, 3, 0.5, 1], [1, 1.25, -1.25, 0.75], [0.75, 2.5, 0.5, 2.25], [2.25, 4.5, 2, 4], [4, 6.5, 3.5, 6], [6, 9, 5.5, 8.5], [8.5, 10.5, 8, 10], [10, 10.25, 8.5, 9]],
    decisionIndex: 6,
    levels: [{ label: 'Swing low', units: 0, kind: 'swing_low' }],
    idealDecision: 'trade',
    ideal: { entry: 2.25, stop: -1.75, zone: [1.75, 2.75] },
    bias: 'neutral',
    trend: 'range',
    volatility: 'high',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: false, breakoutStrength: 'normal', entryQuality: 'ideal' },
    explanation: (_l, d) => [
      `Price ran just ${d === 'long' ? 'below the swing low' : 'above the swing high'}, taking out the obvious stops.`,
      'It was rejected immediately and closed back inside — no acceptance beyond the level.',
      'The next candle confirmed the shift in structure before entry.',
      'The stop sits beyond the sweep extreme, where the idea would be wrong.',
    ],
    lesson: 'A sweep is only a reversal setup if price is quickly rejected and closes back inside. The structure shift is the entry trigger.',
    commonMistake: 'Fading the move into the level before it has actually swept and been rejected.',
    badges: ['CLEAN REJECTION'],
  },
  sweep_accepted: {
    strategyId: 'liquidity-sweep',
    candles: [[8, 8.5, 4, 4.5], [4.5, 5, 0, 1], [1, 4, 0.5, 3.5], [3.5, 4.5, 2, 2.5], [2.5, 3, 0.5, 1], [1, 1.25, -1.5, -1.25], [-1.25, -0.5, -2.5, -2], [-2, -1.5, -4, -3.5], [-3.5, -3, -5.5, -5], [-5, -4, -6, -4.5], [-4.5, -3.5, -5.5, -5]],
    decisionIndex: 6,
    levels: [{ label: 'Swing low', units: 0, kind: 'swing_low' }],
    idealDecision: 'wait',
    bias: 'against',
    trend: 'range',
    volatility: 'high',
    characteristics: { trendAligned: false, breakoutStrength: 'strong' },
    explanation: (_l, d) => [
      `Price broke ${d === 'long' ? 'below the swing low' : 'above the swing high'} and kept closing beyond it.`,
      'Two consecutive closes beyond the level = acceptance, not a sweep.',
      'Without a close back inside, the liquidity-sweep reversal rules are not met.',
    ],
    lesson: 'Acceptance beyond a level (closes holding outside) cancels a sweep idea. Wait for a close back inside.',
    commonMistake: 'Fading a real breakout because the level "should" hold.',
  },
  breakout_retest: {
    strategyId: 'breakout-retest',
    candles: [[0, 3, -0.5, 2.5], [2.5, 6, 2, 3.5], [3.5, 5.75, 1.5, 5], [5, 9, 4.75, 8.5], [8.5, 10, 7.5, 8], [8, 8.5, 6.25, 6.75], [6.75, 9.5, 6.5, 9.25], [9.25, 11, 8.75, 10.5], [10.5, 13, 10, 12.5], [12.5, 14, 11.5, 13], [13, 16.5, 12.75, 16], [16, 17, 15, 15.5]],
    decisionIndex: 6,
    levels: [{ label: 'Resistance', units: 6, kind: 'resistance' }],
    idealDecision: 'trade',
    ideal: { entry: 9.25, stop: 5.75, zone: [8.5, 9.75] },
    bias: 'with',
    trend: 'with',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: true, breakoutStrength: 'strong', entryQuality: 'ideal' },
    explanation: (l, d) => [
      `A pre-marked ${l.toLowerCase()} had capped price twice.`,
      `A strong candle closed ${d === 'long' ? 'above' : 'below'} it, then price retested the level for the first time.`,
      'The retest held and the confirmation candle closed back in the breakout direction.',
    ],
    lesson: 'Old resistance becoming support on the first retest is the core of Breakout + Retest. The close and the hold matter more than the wick.',
    commonMistake: 'Buying the breakout candle with no tested level to place a stop behind.',
    badges: ['A+ EXAMPLE', 'FIRST RETEST', 'CLEAN BREAKOUT', 'STRONG R:R'],
  },
  breakout_third_retest: {
    strategyId: 'breakout-retest',
    candles: [[0, 3, -0.5, 2.5], [2.5, 6, 2, 3.5], [3.5, 5.75, 1.5, 5], [5, 7, 4.75, 6.75], [6.75, 7.5, 5.5, 6], [6, 7.25, 5.25, 7], [7, 7.75, 5.5, 5.75], [5.75, 6.75, 5.5, 6.5], [6.5, 7, 3.75, 4], [4, 4.5, 1.5, 2], [2, 3, 0.5, 1], [1, 2.5, 0.5, 2.25]],
    decisionIndex: 7,
    levels: [{ label: 'Resistance', units: 6, kind: 'resistance' }],
    idealDecision: 'wait',
    bias: 'neutral',
    trend: 'range',
    volatility: 'low',
    characteristics: { retestNumber: 3, firstRetest: false, trendAligned: false, breakoutStrength: 'weak', entryQuality: 'late' },
    explanation: (l) => [
      `The break of ${l.toLowerCase()} was shallow and has now been retested three times.`,
      'Each retest closed back below the level before bouncing.',
      'Without a clean hold, the breakout is not confirmed.',
    ],
    lesson: 'Breakout + Retest is strongest on the first clean retest. Repeated retests that close back through the level signal absorption.',
    commonMistake: 'Assuming a level that held twice will hold a third time.',
  },
  pd_level_breakout: {
    strategyId: 'pdh-breakout',
    candles: [[0, 3, -0.5, 2.5], [2.5, 5.5, 2, 5], [5, 5.75, 3.5, 4], [4, 9, 3.75, 8.5], [8.5, 10, 7.5, 9.5], [9.5, 10, 6.25, 7], [7, 9.5, 6.75, 9.25], [9.25, 11, 8.75, 10.5], [10.5, 13, 10, 12.5], [12.5, 14, 11.5, 13], [13, 16.5, 12.75, 16], [16, 17, 15, 15.5]],
    decisionIndex: 6,
    levels: [{ label: 'Previous day high', units: 6, kind: 'pdh' }],
    idealDecision: 'trade',
    ideal: { entry: 9.25, stop: 5.75, zone: [8.5, 9.75] },
    bias: 'with',
    trend: 'with',
    volatility: 'normal',
    characteristics: { retestNumber: 1, firstRetest: true, trendAligned: true, breakoutStrength: 'strong', entryQuality: 'ideal' },
    explanation: (l, d) => [
      `Price broke the ${l.toLowerCase()} and showed acceptance with closes ${d === 'long' ? 'above' : 'below'} it.`,
      'The first retest of the level held.',
      'Entry came on the confirmation candle, with the stop back through the level.',
    ],
    lesson: "Yesterday's extremes are widely watched. Acceptance beyond them plus a holding retest is the trigger — not the first poke through.",
    commonMistake: 'Entering on the first poke through the level before acceptance.',
    badges: ['FIRST RETEST', 'TREND ALIGNED'],
  },
  flag_break: {
    strategyId: 'momentum-continuation',
    candles: [[0, 2, -0.5, 1.5], [1.5, 5, 1.25, 4.75], [4.75, 8.5, 4.5, 8.25], [8.25, 8.75, 7, 7.25], [7.25, 7.75, 6.5, 6.75], [6.75, 7.5, 6.25, 7.25], [7.25, 9.5, 7, 9.25], [9.25, 11, 9, 10.75], [10.75, 13, 10.5, 12.75], [12.75, 16, 12.5, 15.5], [15.5, 16.25, 14.5, 15]],
    decisionIndex: 6,
    levels: [],
    idealDecision: 'trade',
    ideal: { entry: 9.25, stop: 5.75, zone: [8.75, 9.5] },
    bias: 'with',
    trend: 'with',
    volatility: 'high',
    characteristics: { trendAligned: true, breakoutStrength: 'strong', entryQuality: 'ideal' },
    explanation: (_l, d) => [
      `A strong impulsive move ${d === 'long' ? 'up' : 'down'} formed the flag pole.`,
      'Price pulled back in small, controlled candles — a shallow flag.',
      'A candle closed out of the flag in the impulse direction.',
    ],
    lesson: 'Shallow, orderly flags show the impulse side still in control. The close out of the flag is the trigger.',
    commonMistake: 'Entering inside the flag before it breaks, or after a deep, sloppy pullback.',
    badges: ['TREND ALIGNED', 'CLEAN BREAKOUT'],
  },
};

/** Same rule-valid setup, but the market reverses into the stop — valid setups can and do lose. */
function stoppedVariant(base: Archetype, future: U[]): Archetype {
  return {
    ...base,
    candles: [...base.candles.slice(0, base.decisionIndex + 1), ...future],
    badges: [],
    explanation: (l, d) => [...base.explanation(l, d), 'Even so, this valid setup reached its stop — a reminder that rule-valid trades still lose some of the time.'],
    lesson: `${base.lesson} A valid setup is about process, not certainty: the defined stop kept this loss to 1R.`,
  };
}

ARCHETYPES.orb_first_retest_stopped = stoppedVariant(ARCHETYPES.orb_first_retest, [
  [9.25, 10, 7.5, 8],
  [8, 8.5, 5.5, 6],
  [6, 7, 4.5, 5],
  [5, 6.5, 4, 6],
  [6, 7.5, 5.5, 7],
]);
ARCHETYPES.trend_pullback_stopped = stoppedVariant(ARCHETYPES.trend_pullback, [
  [8, 9, 6.5, 7],
  [7, 7.5, 4.25, 4.75],
  [4.75, 6, 3.5, 5.5],
  [5.5, 6.5, 4.5, 6],
  [6, 7, 5, 6.5],
]);

// ───────────────────────── Instrument scaling ─────────────────────────

/** Points per pattern unit and a typical base price per instrument (illustrative). */
const SCALE: Record<string, { unit: number; base: number }> = {
  ES: { unit: 1, base: 6020 },
  MES: { unit: 1, base: 6020 },
  NQ: { unit: 4, base: 21400 },
  MNQ: { unit: 4, base: 21400 },
  YM: { unit: 8, base: 44100 },
  MYM: { unit: 8, base: 44100 },
  RTY: { unit: 0.4, base: 2240 },
  M2K: { unit: 0.4, base: 2240 },
  CL: { unit: 0.04, base: 71.2 },
  MCL: { unit: 0.04, base: 71.2 },
  GC: { unit: 0.8, base: 2650 },
  MGC: { unit: 0.8, base: 2650 },
};

export const PRACTICE_INSTRUMENTS = Object.keys(SCALE);

export interface ScenarioSpec {
  id: string;
  archetype: keyof typeof ARCHETYPES;
  instrument: string;
  direction: Dir;
  session: PracticeSession;
  /** Day offset used for the sample date label. */
  day: number;
  difficulty: PracticeDifficulty;
  great?: boolean;
  /** Small shift of the base price so scenarios on the same instrument differ. */
  shift?: number;
}

const SAMPLE_SOURCE = {
  kind: 'educational_sample' as const,
  verified: false,
  note: 'Educational sample built from a common price pattern — not recorded market data.',
};

function sampleDate(day: number): string {
  const d = new Date(Date.UTC(2025, 0, 6));
  // Weekdays only.
  let added = 0;
  while (added < day) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function timestamps(date: string, session: PracticeSession, count: number): string[] {
  const startMin = session === 'morning' ? 9 * 60 + 30 : 13 * 60;
  return Array.from({ length: count }, (_, i) => {
    const m = startMin + i * 5;
    return `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00-05:00`;
  });
}

/** Build one scenario from a spec. Pure and deterministic. */
export function buildScenario(spec: ScenarioSpec): PracticeScenario {
  const a = ARCHETYPES[spec.archetype];
  const { unit, base } = SCALE[spec.instrument];
  const sign = spec.direction === 'long' ? 1 : -1;
  const b = base + (spec.shift ?? 0) * unit;
  const px = (u: number) => roundToTick(spec.instrument, b + sign * u * unit);
  const spec2 = getInstrument(spec.instrument);
  const template = getTemplate(a.strategyId);
  const strategyId = spec.direction === 'short' && a.strategyId === 'pdh-breakout' ? 'pdl-breakdown' : a.strategyId;
  const strategyName = getTemplate(strategyId)?.shortName ?? template?.shortName ?? strategyId;
  const rr = getTemplate(strategyId)?.defaultRiskReward ?? 2;
  const date = sampleDate(spec.day);
  const ts = timestamps(date, spec.session, a.candles.length);

  const candles: PracticeCandle[] = a.candles.map(([o, h, l, c], i) => {
    const [hi, lo] = sign === 1 ? [h, l] : [l, h];
    return { timestamp: ts[i], open: px(o), high: px(hi), low: px(lo), close: px(c), volume: Math.round(800 + ((i * 37 + spec.day * 11) % 9) * 120 + (i === 3 ? 900 : 0)) };
  });

  const levelLabel = (label: string) =>
    spec.direction === 'short'
      ? label.replace('Previous day high', 'Previous day low').replace('Swing low', 'Swing high').replace('Resistance', 'Support').replace('Prior swing high', 'Prior swing low')
      : label;
  const levelKind = (k: PracticeLevel['kind']): PracticeLevel['kind'] =>
    spec.direction === 'short' ? ({ pdh: 'pdl', swing_low: 'swing_high', resistance: 'support' } as Record<string, PracticeLevel['kind']>)[k] ?? k : k;
  const levels = a.levels.map((l) => ({ label: levelLabel(l.label), price: px(l.units), kind: levelKind(l.kind) }));
  // Mirrored (short) patterns flip which side of the opening range each level is on.
  if (spec.direction === 'short') {
    for (const l of levels) {
      if (l.kind === 'orb_high') Object.assign(l, { kind: 'orb_low', label: 'OR Low' });
      else if (l.kind === 'orb_low') Object.assign(l, { kind: 'orb_high', label: 'OR High' });
    }
  }

  let idealTrade: PracticeScenario['idealTrade'];
  let zone: [number, number] | undefined;
  if (a.ideal) {
    const entry = px(a.ideal.entry);
    const stop = px(a.ideal.stop);
    const target = roundToTick(spec.instrument, entry + (entry - stop) * rr);
    idealTrade = { entry, stop, target, riskReward: rr };
    const z = [px(a.ideal.zone[0]), px(a.ideal.zone[1])];
    zone = [Math.min(z[0], z[1]), Math.max(z[0], z[1])];
  }

  const decision: PracticeDecision = a.idealDecision === 'wait' ? 'wait' : spec.direction;
  const htf = a.bias === 'neutral' ? 'neutral' : (a.bias === 'with') === (spec.direction === 'long') ? 'bullish' : 'bearish';
  const trend = a.trend === 'range' ? 'range' : spec.direction === 'long' ? 'uptrend' : 'downtrend';
  const level = levels[0]?.label ?? (a.vwap ? 'VWAP' : 'structure');

  // Outcome of the ideal trade, simulated on the scenario's own candles.
  let outcome: PracticeScenario['outcome'];
  if (idealTrade) {
    const sim = simulatePracticeTrade(candles, a.decisionIndex, { decision, entry: idealTrade.entry, stop: idealTrade.stop, target: idealTrade.target });
    outcome = {
      result: sim.status === 'target' ? 'win' : sim.status === 'stop' ? 'loss' : 'no-trade',
      targetReached: sim.status === 'target',
      stopReached: sim.status === 'stop',
      maxFavorableExcursion: sim.mfe ?? undefined,
      maxAdverseExcursion: sim.mae ?? undefined,
      summary:
        sim.status === 'target'
          ? `Price reached the 1:${rr} target before the stop.`
          : sim.status === 'stop'
            ? 'Price reversed and reached the stop — a valid setup that lost.'
            : 'Neither target nor stop was reached before the session ended.',
    };
  } else {
    const last = candles[candles.length - 1].close;
    const at = candles[a.decisionIndex].close;
    const moved = (last - at) * sign;
    outcome = {
      result: 'no-trade',
      summary:
        moved < 0
          ? `Price moved against the ${spec.direction} idea after the decision point — standing aside avoided a losing trade.`
          : 'Price drifted without a clean setup — there was no rule-based entry.',
    };
  }

  return {
    id: spec.id,
    instrument: spec.instrument,
    strategyId,
    strategyName,
    date,
    session: spec.session,
    difficulty: spec.difficulty,
    direction: spec.direction,
    quality: spec.great ? 'great' : a.idealDecision === 'wait' ? 'trap' : 'standard',
    source: SAMPLE_SOURCE,
    marketContext: {
      higherTimeframeBias: htf,
      trend,
      volatility: a.volatility,
      openingRangeSize: a.openingRange ? Math.round(((a.openingRange.high - a.openingRange.low) * unit) / spec2.tickSize) * spec2.tickSize : undefined,
      notes: `${spec.session === 'morning' ? 'NY morning' : 'NY afternoon'} session · ${a.volatility} volatility`,
    },
    candles,
    decisionIndex: a.decisionIndex,
    levels,
    vwap: a.vwap?.map(px),
    openingRange: a.openingRange
      ? { from: a.openingRange.from, to: a.openingRange.to, high: Math.max(px(a.openingRange.high), px(a.openingRange.low)), low: Math.min(px(a.openingRange.high), px(a.openingRange.low)) }
      : undefined,
    idealDecision: decision,
    idealTrade,
    idealEntryZone: zone,
    setupCharacteristics: { ...a.characteristics, trendAligned: a.characteristics.trendAligned },
    explanation: a.explanation(level, spec.direction),
    lesson: a.lesson,
    commonMistake: a.commonMistake,
    badges: spec.great ? (a.badges ?? []) : [],
    outcome,
  };
}
