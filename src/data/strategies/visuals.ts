import type { VisualCandle, VisualChart, VisualExampleBuilder, VisualLine, VisualStage, VisualTrade, VisualZone } from './schema';

/**
 * Reusable diagram builders for strategy visual examples.
 *
 * Each builder draws one well-known price pattern in abstract chart units
 * (0–100) and labels its five stages. Templates pick a builder and supply
 * their own wording, so every strategy gets its own visual without a
 * hand-written chart per strategy. These are illustrations, not market data.
 */

type Direction = 'long' | 'short';
type StageText = Partial<Record<1 | 2 | 3 | 4 | 5, { title?: string; detail?: string }>>;

interface CommonOptions {
  /** Name of the key level / line, e.g. "ORB high", "VWAP". */
  level: string;
  direction?: Direction;
  stages?: StageText;
  whyItWorks?: string[];
  mistake?: { title?: string; explanation?: string };
}

const c = (o: number, h: number, l: number, cl: number): VisualCandle => ({ o, h, l, c: cl });
const round = (n: number) => Math.round(n * 100) / 100;
/** Level name for use mid-sentence: "Resistance" → "resistance", but "ORB high" / "VWAP" stay as-is. */
const inline = (level: string) => (/^[A-Z0-9]{2,}/.test(level) ? level : level.charAt(0).toLowerCase() + level.slice(1));

function trade(entryCandle: number, entry: number, stop: number, rr: number): VisualTrade {
  return { entryCandle, entry, stop, target: round(entry + (entry - stop) * rr) };
}

function stage(step: number, candle: number, at: 'high' | 'low', title: string, detail: string, text?: StageText): VisualStage {
  const o = text?.[step as 1 | 2 | 3 | 4 | 5];
  return { step, candle, at, title: o?.title ?? title, detail: o?.detail ?? detail };
}

/** Flip a long diagram into its short mirror image (and vice versa). */
function mirrorChart<T extends VisualChart>(chart: T): T {
  const m = (v: number) => round(100 - v);
  const flipAt = (at: 'high' | 'low'): 'high' | 'low' => (at === 'high' ? 'low' : 'high');
  return {
    ...chart,
    candles: chart.candles.map((k) => ({ o: m(k.o), h: m(k.l), l: m(k.h), c: m(k.c) })),
    lines: chart.lines.map((ln): VisualLine => ({ ...ln, value: ln.value != null ? m(ln.value) : undefined, values: ln.values?.map(m) })),
    zones: chart.zones?.map((z): VisualZone => ({ ...z, top: m(z.bottom), bottom: m(z.top) })),
    stages: chart.stages?.map((s) => ({ ...s, at: flipAt(s.at) })),
    trade: chart.trade ? { ...chart.trade, entry: m(chart.trade.entry), stop: m(chart.trade.stop), target: m(chart.trade.target) } : undefined,
    mistake: chart.mistake ? { ...chart.mistake, price: m(chart.mistake.price) } : undefined,
  };
}

const words = (d: Direction) =>
  d === 'long'
    ? { beyond: 'above', back: 'below', side: 'buyers', up: 'up', low: 'low' }
    : { beyond: 'below', back: 'above', side: 'sellers', up: 'down', low: 'high' };

// ───────────────────────── A. Breakout + retest ─────────────────────────

export interface BreakoutRetestOptions extends CommonOptions {
  /** Shaded range the level comes from (e.g. the opening range). */
  zone?: string;
}

/**
 * Level → breakout close → retest → hold → entry.
 * Common mistake: chasing a break that never retests.
 */
export function breakoutRetest(opts: BreakoutRetestOptions): VisualExampleBuilder {
  return (rr) => {
    const d = opts.direction ?? 'long';
    const w = words(d);
    const L = 60;
    const lines = [{ label: opts.level, value: L }];
    const zones = opts.zone ? [{ label: opts.zone, top: L, bottom: 48, from: 0, to: 2 }] : undefined;
    const lead = [c(50, 54, 48, 53), c(53, 57, 51, 52), c(52, 59.5, 50, 57), c(57, 59.5, 54, 55), c(55, 58, 53, 57), c(57, 66, 56, 65)];
    const diagram = {
      candles: [...lead, c(65, 67, 62, 63), c(63, 64, 59.6, 61), c(61, 66, 60.5, 65), c(65, 70, 64, 69), c(69, 74, 68, 73), c(73, 78.5, 72, 77.5), c(77.5, 79, 75, 76)],
      lines,
      zones,
      trade: trade(8, 65, 58.5, rr),
      stages: [
        stage(1, 2, 'high', 'Level marked', `${opts.level} is marked before price reaches it.`, opts.stages),
        stage(2, 5, 'high', 'Breakout close', `A candle closes ${w.beyond} the ${inline(opts.level)} — a real close, not just a wick.`, opts.stages),
        stage(3, 7, 'low', 'Retest', `Price comes back to test the broken ${inline(opts.level)}.`, opts.stages),
        stage(4, 8, 'low', 'Hold confirmed', `The level holds and a candle closes back in the breakout direction.`, opts.stages),
        stage(5, 9, 'high', 'Entry', `Enter as the hold confirms. Stop goes ${w.back} the retest; the target is ${rr}× the risk.`, opts.stages),
      ],
    };
    const mistake = {
      candles: [...lead, c(65, 70, 64, 69), c(69, 73.5, 68, 73), c(73, 74, 63, 64), c(64, 65, 58, 59)],
      lines,
      zones,
      mistake: { candle: 7, price: 73, label: 'Chased entry' },
    };
    return {
      direction: d,
      rr,
      diagram: d === 'long' ? diagram : mirrorChart(diagram),
      whyItWorks: opts.whyItWorks,
      mistake: {
        title: opts.mistake?.title ?? 'Break with no retest',
        explanation:
          opts.mistake?.explanation ??
          `Price broke the ${inline(opts.level)} but never came back to retest it. Entering here is chasing an extended move — there is no tested level to place a stop behind, and the rules require a retest that holds. No retest, no trade.`,
        chart: d === 'long' ? mistake : mirrorChart(mistake),
      },
      realExamples: [],
    };
  };
}

// ───────────────────────── B. Failed break / sweep / rejection ─────────────────────────

export interface ReversalAtLevelOptions extends CommonOptions {
  variant: 'failed_break' | 'sweep' | 'rejection' | 'double_top';
  zone?: string;
}

/**
 * Price pushes through (or into) a level and fails → reversal entry.
 * Default is a short at resistance; pass direction 'long' for the support version.
 * Common mistake: fading a level that price has actually accepted beyond.
 */
export function reversalAtLevel(opts: ReversalAtLevelOptions): VisualExampleBuilder {
  return (rr) => {
    const d = opts.direction ?? 'short';
    const L = 60;
    if (opts.variant === 'double_top') return doubleTop(opts, rr, d);
    const probe =
      opts.variant === 'failed_break' ? c(58, 62.5, 57, 61.5) : opts.variant === 'sweep' ? c(58, 63, 57, 58.5) : c(57.5, 61, 56.5, 57.5);
    const fail = opts.variant === 'failed_break' ? c(61.5, 63, 57.5, 58) : c(58.5, 59.5, 56.5, 57);
    const lead = [c(50, 53, 48, 52), c(52, 56, 51, 55), c(55, 59.5, 54, 58), probe];
    const extreme = Math.max(probe.h, fail.h);
    const lines = [{ label: opts.level, value: L }];
    const zones = opts.zone ? [{ label: opts.zone, top: L, bottom: 48, from: 0, to: 2 }] : undefined;
    const t = trade(5, 55.5, round(extreme + 1), rr);
    const tail = [c(55.5, 56.5, 51, 52), c(52, 53, 46, 47), c(47, 48, 41.5, 42.5), c(42.5, 43.5, 36, 37), c(37, 38, 33, 34)];
    const texts: Record<ReversalAtLevelOptions['variant'], [string, string, string, string]> = {
      failed_break: ['Breaks out', `Price closes beyond the ${inline(opts.level)}, trapping breakout buyers.`, 'Fails back inside', `The next candle closes back on the original side — the break did not hold.`],
      sweep: ['Sweep', `Price spikes just beyond the ${inline(opts.level)}, running the stops resting there.`, 'Rejected', 'It closes back inside straight away — no acceptance beyond the level.'],
      rejection: ['Test', `Price rallies into the ${inline(opts.level)}.`, 'Rejection wick', 'A long wick and a weak close show the level is holding.'],
      double_top: ['', '', '', ''],
    };
    const [t2, d2, t3, d3] = texts[opts.variant];
    const diagram = {
      candles: [...lead, fail, c(57, 58, 55, 55.5), ...tail],
      lines,
      zones,
      trade: t,
      stages: [
        stage(1, 1, 'high', 'Level marked', `${opts.level} is marked in advance.`, opts.stages),
        stage(2, 3, 'high', t2, d2, opts.stages),
        stage(3, 4, 'high', t3, d3, opts.stages),
        stage(4, 5, 'low', 'Confirmation', 'The next candle continues away from the level.', opts.stages),
        stage(5, 6, 'low', 'Entry', `Enter on the confirmation. Stop beyond the extreme; target ${rr}× the risk.`, opts.stages),
      ],
    };
    const mistake = {
      candles: [...lead.slice(0, 3), c(58, 62.5, 57, 61.5), c(61.5, 64, 60.5, 63.5), c(63.5, 67, 62.5, 66), c(66, 70, 65, 69)],
      lines,
      zones,
      mistake: { candle: 4, price: 63.5, label: 'Faded too early' },
    };
    return {
      direction: d,
      rr,
      diagram: d === 'short' ? diagram : mirrorChart(diagram),
      whyItWorks: opts.whyItWorks,
      mistake: {
        title: opts.mistake?.title ?? 'Price accepted beyond the level',
        explanation:
          opts.mistake?.explanation ??
          `Price went through the ${inline(opts.level)} and kept closing beyond it. That is acceptance, not a failure — fading it means trading against a real breakout. Wait for a close back inside.`,
        chart: d === 'short' ? mistake : mirrorChart(mistake),
      },
      realExamples: [],
    };
  };
}

function doubleTop(opts: ReversalAtLevelOptions, rr: number, d: Direction) {
  const neck = 51.5;
  const lines = [
    { label: opts.level, value: 60 },
    { label: 'Neckline', value: neck },
  ];
  const lead = [c(44, 48, 43, 47), c(47, 54, 46, 53), c(53, 60, 52, 56), c(56, 57, 51.5, 52.5), c(52.5, 58, 52, 57), c(57, 60.2, 55.5, 56)];
  const diagram = {
    candles: [...lead, c(56, 56.5, 50.5, 51), c(51, 52, 45, 46), c(46, 47, 40, 41), c(41, 42, 35, 36), c(36, 37, 30, 31)],
    lines,
    trade: trade(6, 51, 61.2, rr),
    stages: [
      stage(1, 2, 'high', 'First top', 'Price rallies and stalls at the high.', opts.stages),
      stage(2, 5, 'high', 'Second test fails', 'Price returns to the same high and cannot push through.', opts.stages),
      stage(3, 3, 'low', 'Neckline', 'The low between the two tops is the neckline.', opts.stages),
      stage(4, 6, 'high', 'Neckline break', 'A candle closes through the neckline — structure has shifted.', opts.stages),
      stage(5, 7, 'low', 'Entry', `Enter on the break. Stop beyond the second top; target ${rr}× the risk.`, opts.stages),
    ],
  };
  const mistake = {
    candles: [...lead, c(56, 57, 52.5, 53.5), c(53.5, 58, 53, 57.5), c(57.5, 63, 57, 62.5)],
    lines,
    mistake: { candle: 5, price: 56, label: 'No neckline break' },
  };
  return {
    direction: d,
    rr,
    diagram: d === 'short' ? diagram : mirrorChart(diagram),
    whyItWorks: opts.whyItWorks,
    mistake: {
      title: opts.mistake?.title ?? 'Entering before the neckline breaks',
      explanation:
        opts.mistake?.explanation ?? 'Two tops alone are not the setup. Without a close through the neckline the pattern is unconfirmed — here price held the neckline and broke higher instead.',
      chart: d === 'short' ? mistake : mirrorChart(mistake),
    },
    realExamples: [],
  };
}

// ───────────────────────── C. Pullback continuation ─────────────────────────

export interface PullbackOptions extends CommonOptions {
  /** 'curve' for VWAP/EMA, 'level' for prior structure, 'none' to show structure only. */
  guide: 'curve' | 'level' | 'none';
}

/**
 * Trend → orderly pullback → hold at the line → confirmation → entry.
 * Common mistake: buying a pullback that closes through the line.
 */
export function pullbackContinuation(opts: PullbackOptions): VisualExampleBuilder {
  return (rr) => {
    const d = opts.direction ?? 'long';
    const w = words(d);
    const curve = [35, 37.5, 40, 43, 46, 48.5, 49.5, 51, 53, 55, 57, 58.5];
    const lines: VisualLine[] = opts.guide === 'curve' ? [{ label: opts.level, values: curve }] : opts.guide === 'level' ? [{ label: opts.level, value: 48.5 }] : [];
    const lead = [c(40, 44, 39, 43), c(43, 48, 42, 47), c(47, 53, 46, 52), c(52, 56, 51, 55), c(55, 56, 51, 52)];
    const diagram = {
      candles: [...lead, c(52, 53, 48.5, 50), c(50, 55, 49.5, 54.5), c(54.5, 59, 54, 58), c(58, 63, 57, 62), c(62, 67, 61, 66), c(66, 70, 65, 69.5), c(69.5, 71, 67.5, 68.5)],
      lines,
      trade: trade(6, 54.5, 47.5, rr),
      stages: [
        stage(1, 2, 'high', 'Trend established', `Price is trending ${w.up} with clear impulse candles.`, opts.stages),
        stage(2, 4, 'high', 'Pullback', 'Price pulls back in small, orderly candles.', opts.stages),
        stage(3, 5, 'low', opts.guide === 'none' ? `Holds the ${inline(opts.level)}` : `Tests ${opts.level}`, opts.guide === 'none' ? `The pullback holds and forms the ${inline(opts.level)}.` : `The pullback reaches ${inline(opts.level)} and holds it.`, opts.stages),
        stage(4, 6, 'low', 'Confirmation', 'A candle closes back in the trend direction.', opts.stages),
        stage(5, 7, 'high', 'Entry', `Enter on the confirmation. Stop beyond the pullback ${w.low}; target ${rr}× the risk.`, opts.stages),
      ],
    };
    const mistake = {
      candles: [...lead, c(52, 53, 45.5, 46), c(46, 47.5, 42.5, 43.5), c(43.5, 45, 40, 41)],
      lines,
      mistake: { candle: 5, price: 46, label: 'Bought the break' },
    };
    return {
      direction: d,
      rr,
      diagram: d === 'long' ? diagram : mirrorChart(diagram),
      whyItWorks: opts.whyItWorks,
      mistake: {
        title: opts.mistake?.title ?? 'Pullback that breaks the trend',
        explanation:
          opts.mistake?.explanation ??
          `This pullback did not hold — it closed straight through ${opts.guide === 'none' ? 'the prior swing' : inline(opts.level)}. That is the trend failing, not a pullback. Without a hold and a confirmation candle there is no entry.`,
        chart: d === 'long' ? mistake : mirrorChart(mistake),
      },
      realExamples: [],
    };
  };
}

// ───────────────────────── D. Extension → mean reversion ─────────────────────────

export interface MeanReversionOptions extends CommonOptions {
  guide: 'curve' | 'none';
}

/**
 * Stretched move → momentum fades → reversal candle → confirmation → entry back toward the mean.
 * Common mistake: fading while momentum is still expanding.
 */
export function meanReversion(opts: MeanReversionOptions): VisualExampleBuilder {
  return (rr) => {
    const d = opts.direction ?? 'short';
    const lines: VisualLine[] = opts.guide === 'curve' ? [{ label: opts.level, values: [49, 49.5, 50, 51, 52, 52.5, 53, 53, 53, 53, 52.5, 52.5] }] : [];
    const lead = [c(50, 53, 49, 52), c(52, 57, 51, 56), c(56, 62, 55, 61), c(61, 68, 60, 67)];
    const diagram = {
      candles: [...lead, c(67, 72, 66, 70.5), c(70.5, 72.5, 68.5, 71), c(71, 72, 67, 68), c(68, 69, 64.5, 65), c(65, 66, 60, 61), c(61, 62, 56, 57), c(57, 58, 52, 53), c(53, 54, 49.5, 50.5)],
      lines,
      trade: trade(7, 65, 73.5, rr),
      stages: [
        stage(1, 4, 'high', 'Extended', `Price stretches far from ${opts.guide === 'curve' ? opts.level : 'value'} in a strong run.`, opts.stages),
        stage(2, 5, 'low', 'Momentum fades', 'Candles shrink and the push stalls.', opts.stages),
        stage(3, 6, 'low', 'Reversal candle', 'A candle closes back through the prior lows.', opts.stages),
        stage(4, 7, 'low', 'Confirmation', 'Follow-through confirms the turn.', opts.stages),
        stage(5, 8, 'low', 'Entry', `Enter on confirmation. Stop beyond the extreme; target ${rr}× the risk${opts.guide === 'curve' ? ` toward ${opts.level}` : ''}.`, opts.stages),
      ],
    };
    const mistake = {
      candles: [...lead, c(67, 74, 66, 73), c(73, 79, 72, 78)],
      lines,
      mistake: { candle: 3, price: 67, label: 'Faded momentum' },
    };
    return {
      direction: d,
      rr,
      diagram: d === 'short' ? diagram : mirrorChart(diagram),
      whyItWorks: opts.whyItWorks,
      mistake: {
        title: opts.mistake?.title ?? 'Fading while momentum is still strong',
        explanation:
          opts.mistake?.explanation ??
          'Price was stretched, but candles were still large and closing at their extremes. Without slowing momentum and a reversal close, there is nothing to trade against yet — the move simply kept going.',
        chart: d === 'short' ? mistake : mirrorChart(mistake),
      },
      realExamples: [],
    };
  };
}
