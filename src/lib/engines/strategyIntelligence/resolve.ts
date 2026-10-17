import { formatClock } from '@/utils/dates';

import { finalizeStructured } from './analyze';
import { conceptById, type ConceptContext } from './concepts';
import { interpretStrategy, makeRule } from './interpret';
import type { LevelRef, Primitive, StopSpec, TargetSpec, TestableRuleSet } from './ruleset';
import type {
  ConfidenceLabel,
  DnaKey,
  ResolutionValues,
  ResolveOption,
  RuleCategory,
  RuleResolution,
  RuleSection,
  StrategyRule,
  StrategyRuleItem,
  StructuredStrategy,
} from './types';
import { findVagueTerms } from './vagueness';

/**
 * RESOLVE MISSING RULES.
 *
 * Turns the gaps and subjective phrases found by the analysis into an
 * interview: one rule item at a time, with options worded for THIS strategy,
 * an optional (clearly labelled) Prop Guard recommendation, and the trader's
 * own custom definition. Nothing becomes part of the strategy until the
 * trader explicitly chooses it — a resolution records that decision.
 */

// ───────────────────────────── Context ─────────────────────────────

interface Ctx {
  s: StructuredStrategy;
  ids: Set<string>;
  text: string;
  inst: string | null;
  dir: 'long' | 'short' | 'both' | null;
  long: boolean;
  short: boolean;
  /** Execution timeframe in words ("5-minute"). */
  tf: string;
  c: ConceptContext;
  /** Example point distances for this contract (examples only — never "correct" values). */
  pts: [number, number];
  rules: StrategyRule[];
  /** Sections covered by trader / inferred rules or accepted suggestions. */
  has: (section: RuleSection) => boolean;
  /** Section covered by a TRADER rule. */
  stated: (section: RuleSection) => boolean;
  breakoutFamily: boolean;
  levelName: string;
}

const EXAMPLE_POINTS: Record<string, [number, number]> = {
  ES: [2, 4],
  MES: [2, 4],
  NQ: [8, 15],
  MNQ: [8, 15],
  YM: [20, 40],
  MYM: [20, 40],
  RTY: [2, 4],
  M2K: [2, 4],
  CL: [0.1, 0.2],
  MCL: [0.1, 0.2],
  GC: [2, 4],
  MGC: [2, 4],
};

const TIMEFRAME_WORD = (t: string | null) => (t ? t.replace(/m$/, '-minute').replace(/h$/, '-hour') : '5-minute');

function contextOf(s: StructuredStrategy): Ctx {
  const interp = interpretStrategy(s.originalText);
  const ids = new Set(s.detectedStyle.map((d) => d.id));
  const accepted = s.aiSuggestedRules.filter((g) => g.status === 'accepted' || g.status === 'edited');
  const rules = allRulesOf(s);
  const inst = s.instrument[0] ?? resolutionValue(s, 'instrument') ?? null;
  const dir = s.direction;
  const tfCode = s.timeframes.find((t) => t.endsWith('m')) ?? s.timeframes[0] ?? null;
  return {
    s,
    ids,
    text: s.originalText,
    inst,
    dir,
    long: dir === 'long' || dir === 'both' || dir == null,
    short: dir === 'short' || dir === 'both',
    tf: TIMEFRAME_WORD(tfCode),
    c: { ...interp.context, direction: dir, concepts: [...ids] },
    pts: EXAMPLE_POINTS[inst ?? ''] ?? [2, 4],
    rules,
    has: (sec) => rules.some((r) => r.section === sec) || accepted.some((g) => g.section === sec),
    stated: (sec) => rules.some((r) => r.section === sec && r.provenance === 'trader'),
    breakoutFamily: ['orb', 'breakout', 'morning_range', 'opening_drive', 'pdh_pdl'].some((x) => ids.has(x)) && !ids.has('liquidity_sweep') && !/\breject/i.test(s.originalText),
    levelName: interp.context.level ?? (ids.has('orb') ? 'the opening range' : ids.has('vwap') ? 'VWAP' : 'the level'),
  };
}

function allRulesOf(s: StructuredStrategy): StrategyRule[] {
  return [
    ...s.biasRules,
    ...s.contextRules,
    ...s.setupRules,
    ...s.entryRules,
    ...s.confirmationRules,
    ...s.stopRules,
    ...s.targetRules,
    ...s.managementRules,
    ...s.invalidationRules,
    ...s.noTradeRules,
    ...s.riskRules,
    ...s.filterRules,
    ...(s.volatilityRules ?? []),
    ...(s.volumeRules ?? []),
  ];
}

function resolutionValue<K extends keyof ResolutionValues>(s: StructuredStrategy, key: K): ResolutionValues[K] | undefined {
  for (const r of s.resolutions ?? []) if (r.values[key] != null) return r.values[key];
  return undefined;
}

// ───────────────────────────── Option helpers ─────────────────────────────

const opt = (
  item: string,
  key: string,
  label: string,
  detail: string,
  ruleText: string,
  section: RuleSection | null,
  confidence: ConfidenceLabel,
  extra: Partial<ResolveOption> = {},
): ResolveOption => ({ id: `${item}:${key}`, label, detail, ruleText, section, confidence, ...extra });

const sideWord = (x: Ctx, up: string, down: string, both: string) => (x.dir === 'long' ? up : x.dir === 'short' ? down : both);
const primaryEdge = (x: Ctx): LevelRef => {
  if (x.ids.has('morning_range')) return /morning low/i.test(x.text) && !/morning high/i.test(x.text) ? { kind: 'orl', minutes: x.s.definitions?.rangeMinutes ?? 60 } : { kind: 'orh', minutes: x.s.definitions?.rangeMinutes ?? 60 };
  if (x.ids.has('orb')) return { kind: 'edge', of: 'or', mode: 'breakout', minutes: x.s.definitions?.rangeMinutes ?? x.c.orbMinutes ?? 15 };
  if (x.ids.has('vwap')) return { kind: 'vwap' };
  if (/previous day'?s? low|\bPDL\b/i.test(x.text)) return { kind: 'pdl' };
  if (/previous day'?s? high|\bPDH\b/i.test(x.text)) return { kind: 'pdh' };
  if (x.c.emaPeriod) return { kind: 'ema', period: x.c.emaPeriod, maType: x.c.emaType === 'SMA' ? 'SMA' : 'EMA' };
  return { kind: 'edge', of: 'range', mode: x.breakoutFamily ? 'breakout' : 'fade' };
};

interface ItemSeed {
  id: string;
  category: RuleCategory;
  title: string;
  dnaKey: DnaKey;
  priority: number;
  required: boolean;
  critical?: boolean;
  subjective?: boolean;
  originalText?: string;
  why: string;
  question: string;
  options: ResolveOption[];
  multiSelect?: boolean;
  recommend?: { optionIds: string[]; reasoning: string };
  /** Sections whose presence means the item is already defined. */
  coveredBy?: RuleSection[];
  testable?: boolean;
}

// ───────────────────────────── Category builders ─────────────────────────────

function instrumentItem(x: Ctx): ItemSeed | null {
  if (x.s.instrument.length) return null;
  const list = ['ES', 'MES', 'NQ', 'MNQ', 'CL', 'GC'];
  return {
    id: 'instrument',
    category: 'instrument',
    title: 'Instrument',
    dnaKey: 'market',
    priority: 1,
    required: true,
    why: 'Stops, targets, tick values and risk all depend on the contract — your description does not say which market you trade.',
    question: 'Which market do you trade this on?',
    options: list.map((i) => opt('instrument', i, i, `Trade this strategy on ${i}`, i, null, 'A', { values: { instrument: i } })),
  };
}

function directionItem(x: Ctx): ItemSeed | null {
  if (x.s.direction && x.s.directionSource === 'trader') return null;
  if (x.s.direction && x.s.directionSource === 'inferred' && !/\bfade|scalp|breakout|trend/i.test(x.text)) return null;
  const inferred = x.s.direction;
  return {
    id: 'direction',
    category: 'direction',
    title: 'Direction',
    dnaKey: 'bias',
    priority: 6,
    required: false,
    why: inferred ? `Prop Guard read the plan as "${inferred === 'both' ? 'both directions' : `${inferred} only`}", but you did not say so explicitly.` : 'The plan does not say whether you buy, sell or both.',
    question: 'Which direction(s) does this strategy trade?',
    options: [
      opt('direction', 'long', 'Long only', 'Only buy setups', 'Long only', 'bias', 'A', { values: { direction: 'long' } }),
      opt('direction', 'short', 'Short only', 'Only sell setups', 'Short only', 'bias', 'A', { values: { direction: 'short' } }),
      opt('direction', 'both', 'Both directions', 'Mirror the rules for shorts', 'Long and short (mirrored rules)', 'bias', 'A', { values: { direction: 'both' } }),
    ],
    recommend: inferred ? { optionIds: [`direction:${inferred}`], reasoning: `Your wording ("${/fade/i.test(x.text) ? 'fade' : /scalp/i.test(x.text) ? 'scalp' : /trend/i.test(x.text) ? 'trends' : 'breakouts'}") works in either direction unless you restrict it.` } : undefined,
  };
}

function timeframeItem(x: Ctx): ItemSeed | null {
  if (x.s.timeframes.length || x.ids.has('order_flow')) return null;
  const scalp = x.ids.has('scalping');
  const opts = [
    opt('timeframe', '1m', '1-minute', 'Fastest signals, most noise', '1-minute chart', null, 'C', { values: { timeframe: '1m' }, tradeoff: 'More signals and faster entries; more false signals and execution pressure.' }),
    opt('timeframe', '2m', '2-minute', 'A compromise for fast markets', '2-minute chart', null, 'C', { values: { timeframe: '2m' } }),
    opt('timeframe', '5m', '5-minute', 'The most common intraday execution chart', '5-minute chart', null, 'C', { values: { timeframe: '5m' }, tradeoff: 'Fewer, cleaner signals; entries a little later.' }),
    opt('timeframe', '15m', '15-minute', 'Slower, structure-focused', '15-minute chart', null, 'C', { values: { timeframe: '15m' }, tradeoff: 'Strongest confirmation; wider stops and fewer trades.' }),
  ];
  const rec = scalp ? '1m' : x.ids.has('trend_continuation') || x.ids.has('pullback') ? '5m' : '5m';
  return {
    id: 'timeframe',
    category: 'timeframe',
    title: 'Timeframe',
    dnaKey: 'timeframe',
    priority: 1,
    required: true,
    why: 'A 1-minute close and a 15-minute close are different rules. Every candle-based rule needs one execution chart to be tested consistently.',
    question: 'Which chart do your entry candles come from?',
    options: opts,
    recommend: { optionIds: [`timeframe:${rec}`], reasoning: scalp ? 'Scalps target small moves — a 1-minute chart lets the entry and stop stay tight enough for the move you are trading.' : 'Your setup is defined by intraday levels; the 5-minute chart is fast enough to enter near the level while filtering most one-candle noise.' },
  };
}

function levelDefinitionItem(x: Ctx): ItemSeed | null {
  const morning = /morning (high|low|range)/i.exec(x.text);
  if (morning && x.s.definitions?.rangeMinutes == null) {
    const which = morning[1].toLowerCase();
    const start = x.s.tradingWindow.start;
    const opts = [
      opt('levelDefinition', '15', `${which === 'low' ? 'Low' : 'High'} of 9:30–9:45`, 'The first 15 minutes of the cash session', `Morning ${which} = ${which === 'low' ? 'lowest' : 'highest'} price from 9:30 to 9:45 AM ET`, 'setup', 'B', { values: { rangeMinutes: 15 } }),
      opt('levelDefinition', '30', `${which === 'low' ? 'Low' : 'High'} of 9:30–10:00`, 'The first 30 minutes', `Morning ${which} = ${which === 'low' ? 'lowest' : 'highest'} price from 9:30 to 10:00 AM ET`, 'setup', 'B', { values: { rangeMinutes: 30 } }),
      opt('levelDefinition', '60', `${which === 'low' ? 'Low' : 'High'} of 9:30–10:30`, 'The first hour', `Morning ${which} = ${which === 'low' ? 'lowest' : 'highest'} price from 9:30 to 10:30 AM ET`, 'setup', 'B', { values: { rangeMinutes: 60 } }),
    ];
    const rec = start === '09:45' ? '15' : start && start >= '10:00' && start < '10:30' ? '30' : '60';
    return {
      id: 'levelDefinition',
      category: 'levelDefinition',
      title: `“Morning ${which}”`,
      dnaKey: 'setup',
      priority: 1,
      required: true,
      subjective: true,
      originalText: morning[0],
      why: `“Morning ${which}” can mean the first 15 minutes, the first hour, or the high so far — each gives a different breakout level.`,
      question: `Which window defines the morning ${which}?`,
      options: opts,
      recommend: { optionIds: [`levelDefinition:${rec}`], reasoning: start ? `You start trading at ${formatClock(start)}; defining the morning ${which} as the range that is complete by then means the level is fixed before you look for the break.` : `A fixed window means the level is known before the breakout — "the high so far" keeps moving.` },
      testable: true,
    };
  }
  if (x.ids.has('orb') && x.c.orbMinutes == null && x.s.definitions?.rangeMinutes == null) {
    return {
      id: 'levelDefinition',
      category: 'levelDefinition',
      title: 'Opening range length',
      dnaKey: 'setup',
      priority: 1,
      required: true,
      subjective: true,
      originalText: 'opening range',
      why: 'The opening range length changes every level the strategy trades from.',
      question: 'How many minutes define your opening range?',
      options: [5, 15, 30, 60].map((m) => opt('levelDefinition', String(m), `${m} minutes`, `High and low of 9:30 to ${formatClock(`${String(9 + Math.floor((30 + m) / 60)).padStart(2, '0')}:${String((30 + m) % 60).padStart(2, '0')}`)}`, `Opening range = high and low of the first ${m} minutes after 9:30 ET`, 'setup', 'B', { values: { rangeMinutes: m } })),
      recommend: { optionIds: ['levelDefinition:15'], reasoning: 'Fifteen minutes lets the opening volatility settle while leaving most of the morning to trade the breakout.' },
    };
  }
  return null;
}

/** Measurable criteria for a subjective phrase, worded for this strategy. */
function criteriaFor(termKey: string, phrase: string, x: Ctx): { options: ResolveOption[]; recommend?: string[]; reasoning?: string; title: string; question: string; multi: boolean } | null {
  const id = `subjective:${termKey}`;
  const lvl = primaryEdge(x);
  const tf = x.tf;
  const up = x.dir !== 'short';
  const levelWord = x.ids.has('morning_range') ? 'the morning range' : x.ids.has('orb') ? 'the opening range' : x.levelName;
  switch (termKey) {
    case 'momentum_strong':
    case 'looks_directional':
    case 'strong_trend':
    case 'trend_undefined': {
      const isTrend = termKey === 'strong_trend' || termKey === 'trend_undefined';
      const options = [
        opt(id, 'hhhl', up ? 'Higher highs + higher lows' : 'Lower highs + lower lows', `At least 2 ${up ? 'higher highs and higher lows' : 'lower highs and lower lows'} on the ${isTrend ? '15-minute' : tf} chart`, `${up ? 'At least 2 higher highs and 2 higher lows' : 'At least 2 lower highs and 2 lower lows'} on the ${isTrend ? '15-minute' : tf} chart`, isTrend ? 'bias' : 'context', 'D', { primitive: { type: 'trend_structure', swings: 2 } }),
        ...(!isTrend
          ? [
              opt(id, 'closeabove', `${tf} close ${up ? 'above' : 'below'} ${levelWord}`, 'Strength shown by acceptance beyond the key level', `A ${tf} candle closes ${up ? 'above' : 'below'} ${levelWord}`, 'context', 'D', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' } }),
            ]
          : []),
        opt(id, 'vwap', `Price ${up ? 'above' : 'below'} VWAP`, 'Session VWAP as the dividing line', `Price is ${up ? 'above' : 'below'} the session VWAP`, 'context', 'D', { primitive: { type: 'close_beyond', level: { kind: 'vwap' }, side: 'trade_dir' } }),
        opt(id, 'rvol', 'Strong relative volume', 'Signal candle volume above its recent average', `Volume of the ${tf} signal candle at least 1.5× the average of the previous 20 candles`, 'volume', 'D', { primitive: { type: 'volume_vs_avg', bars: 20, mult: 1.5 } }),
        opt(id, 'closehigh', `Momentum candle closes near its ${up ? 'high' : 'low'}`, `Close in the ${up ? 'top' : 'bottom'} 25% of the candle's range`, `The ${tf} signal candle closes in the ${up ? 'top' : 'bottom'} 25% of its range`, 'confirmation', 'D', { primitive: { type: 'close_location', pct: 25 } }),
        ...(x.c.emaPeriod ? [opt(id, 'ema', `Above a rising ${x.c.emaPeriod} ${x.c.emaType ?? 'EMA'}`, 'Your moving average defines the trend', `Price ${up ? 'above' : 'below'} the ${x.c.emaPeriod} ${x.c.emaType ?? 'EMA'}`, 'bias', 'D', { primitive: { type: 'ma_side', period: x.c.emaPeriod, maType: x.c.emaType === 'SMA' ? 'SMA' : 'EMA' } })] : []),
      ];
      return {
        title: `“${phrase}”`,
        question: isTrend ? `What makes it ${up ? 'an uptrend' : 'a downtrend'}?` : `What should “${phrase}” mean?`,
        multi: true,
        options,
        recommend: isTrend ? [`${id}:hhhl`] : [`${id}:hhhl`, `${id}:closeabove`],
        reasoning: isTrend
          ? 'Swing structure describes the trend directly from price, without adding a tool your plan does not use.'
          : `Your setup is about ${levelWord}; strength defined as a ${tf} close ${up ? 'above' : 'below'} it plus ${up ? 'rising' : 'falling'} swing structure keeps the definition tied to the level you already trade.`,
      };
    }
    case 'good_volume':
      return {
        title: `“${phrase}”`,
        question: 'What counts as good volume?',
        multi: false,
        options: [
          opt(id, '1.5x', '1.5× the 20-candle average', 'Signal candle clearly above normal', `Volume of the ${tf} signal candle at least 1.5× the average of the previous 20 candles`, 'volume', 'D', { primitive: { type: 'volume_vs_avg', bars: 20, mult: 1.5 } }),
          opt(id, 'prev5', 'Above the previous 5 candles', 'Short-term volume expansion', `Volume of the signal candle above the average of the previous 5 candles`, 'volume', 'D', { primitive: { type: 'volume_vs_avg', bars: 5, mult: 1 } }),
          opt(id, '2x', '2× the 20-candle average', 'Only clear volume spikes', `Volume of the ${tf} signal candle at least 2× the average of the previous 20 candles`, 'volume', 'D', { primitive: { type: 'volume_vs_avg', bars: 20, mult: 2 } }),
        ],
        recommend: [`${id}:1.5x`],
        reasoning: x.ids.has('scalping') ? 'Scalps need participation right now; a 1.5× spike on the signal candle filters quiet bars without demanding rare volume spikes.' : 'A 1.5× threshold separates real participation from normal fluctuation.',
      };
    case 'reverses':
      return {
        title: `“${phrase}”`,
        question: `What counts as ${/reject/i.test(phrase) ? 'a rejection' : 'a reversal'}?`,
        multi: false,
        options: [
          opt(id, 'close', `Close back ${sideWord(x, 'above', 'below', 'across')} ${x.levelName}`, 'The cleanest observable event', `A ${tf} candle closes back ${sideWord(x, 'above', 'below', 'across')} ${x.levelName}`, 'confirmation', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' } }),
          opt(id, 'candle', 'Close in the trade direction', 'Any candle that closes the right way after the touch', `The next ${tf} candle closes in the trade direction`, 'confirmation', 'B', { primitive: { type: 'candle_dir' } }),
        ],
        recommend: [`${id}:close`],
        reasoning: `Tying the reversal to ${x.levelName} makes the confirmation the same event every time.`,
      };
    default:
      return null;
  }
}

function subjectiveItems(x: Ctx): ItemSeed[] {
  const out: ItemSeed[] = [];
  const seen = new Set<string>();
  for (const r of x.rules.filter((y) => y.provenance === 'trader')) {
    for (const hit of findVagueTerms(r.quote ?? r.text, x.text)) {
      if (seen.has(hit.term.key)) continue;
      // Breakout wording is resolved by the breakout-confirmation item; pullbacks by the entry item.
      if (hit.term.key === 'breakout_undefined' || hit.term.key === 'pullback_undefined') continue;
      seen.add(hit.term.key);
      const phrase = r.vagueTerms.find((v) => hit.match.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(hit.match.toLowerCase())) ?? hit.match;
      const bespoke = criteriaFor(hit.term.key, /looks strong|looks weak/i.test(r.text) ? r.text : phrase, x);
      const id = `subjective:${hit.term.key}`;
      const defText = hit.term.suggest(x.c, r.quote ?? r.text);
      const options = bespoke?.options ?? [opt(id, 'pg', 'Prop Guard definition', 'A measurable version of your phrase', defText, hit.term.section ?? r.section, hit.term.confidence)];
      out.push({
        id,
        category: 'subjective',
        title: bespoke?.title ?? `“${hit.match}”`,
        dnaKey: (r.section === 'entry' ? 'entry' : r.section === 'confirmation' ? 'confirmation' : r.section === 'bias' ? 'bias' : r.section === 'context' ? 'context' : 'setup') as DnaKey,
        priority: 1,
        required: true,
        subjective: true,
        originalText: r.text,
        why: `This rule is subjective. Two traders could interpret “${hit.match}” differently, so the setup cannot be tested consistently until it is defined.`,
        question: bespoke?.question ?? `What should “${hit.match}” mean?`,
        options,
        multiSelect: bespoke?.multi ?? false,
        recommend: { optionIds: bespoke?.recommend ?? [options[0].id], reasoning: bespoke?.reasoning ?? 'This keeps your idea and gives it a threshold that can be checked on a chart.' },
        testable: true,
      });
    }
  }
  return out;
}

function breakoutItem(x: Ctx): ItemSeed | null {
  if (!x.breakoutFamily) return null;
  const confirmed = x.rules.some((r) => r.provenance === 'trader' && /close|retest|candle/i.test(r.text) && (r.section === 'confirmation' || r.section === 'entry' || r.section === 'setup'));
  if (confirmed) return null;
  const lvl = primaryEdge(x);
  const levelWord = x.ids.has('morning_range') ? `the morning ${/morning low/i.test(x.text) ? 'low' : 'high'}` : x.ids.has('orb') ? 'the opening range' : 'the level';
  const above = sideWord(x, 'above', 'below', 'beyond');
  const id = 'breakoutDefinition';
  const chaseConcern = /chas/i.test(x.text);
  return {
    id,
    category: 'breakoutDefinition',
    title: 'What counts as a breakout?',
    dnaKey: 'confirmation',
    priority: 1,
    required: true,
    subjective: true,
    originalText: x.rules.find((r) => /break/i.test(r.text))?.text,
    why: `“Breaks ${levelWord}” could mean a single tick through it or a candle that closes there. Each version produces different trades.`,
    question: 'What counts as a breakout?',
    options: [
      opt(id, 'trade', `Price trades ${above} the level`, 'Any trade through it', `Price trades ${above} ${levelWord}`, 'confirmation', 'B', { primitive: { type: 'trades_beyond', level: lvl }, tradeoff: 'Earlier entry, more false breakouts.' }),
      opt(id, '1m', `1-minute candle closes ${above}`, 'Fast confirmation', `A 1-minute candle closes ${above} ${levelWord}`, 'confirmation', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' }, values: { timeframe: '1m' }, tradeoff: 'Faster than a 5-minute close, but more wicks qualify.' }),
      opt(id, '5m', `5-minute candle closes ${above}`, 'Standard confirmation', `A 5-minute candle closes ${above} ${levelWord}`, 'confirmation', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' }, values: { timeframe: '5m' }, tradeoff: 'Slower entry, stronger confirmation.' }),
      opt(id, 'retest', 'Break + retest', 'Close beyond, then a pullback that holds', `A 5-minute close ${above} ${levelWord}, then a retest of the level that holds`, 'confirmation', 'B', { primitive: { type: 'retest_hold', level: lvl }, values: { timeframe: '5m' }, tradeoff: 'May reduce chasing, but some trades leave without retesting.' }),
      opt(id, 'volume', 'Break + volume confirmation', 'Close beyond on above-average volume', `A ${x.tf} close ${above} ${levelWord} on volume at least 1.5× the 20-candle average`, 'confirmation', 'D', { primitive: { type: 'all', of: [{ type: 'close_beyond', level: lvl, side: 'trade_dir' }, { type: 'volume_vs_avg', bars: 20, mult: 1.5 }] }, tradeoff: 'Filters weak breaks; skips some valid quiet ones.' }),
    ],
    recommend: chaseConcern
      ? { optionIds: [`${id}:retest`], reasoning: 'You said you don’t want to chase. Waiting for the retest puts the entry back near the level instead of after the breakout candle has run.' }
      : { optionIds: [`${id}:5m`], reasoning: 'A 5-minute close filters most wicks through the level while keeping the entry close to the breakout.' },
    testable: true,
  };
}

function chaseItem(x: Ctx): ItemSeed | null {
  const mentioned = /\bchas(e|ing)\b|extended|don'?t (want to )?(buy|sell) the top/i.test(x.text);
  if (!mentioned && !(x.breakoutFamily && (x.ids.has('momentum') || x.ids.has('opening_drive')))) return null;
  const lvl = primaryEdge(x);
  const [a, b] = x.pts;
  const unit = x.inst ? `${x.inst} points` : 'points';
  const id = 'chaseProtection';
  return {
    id,
    category: 'chaseProtection',
    title: 'Chase protection',
    dnaKey: 'entry',
    priority: 5,
    required: mentioned,
    subjective: mentioned,
    originalText: mentioned ? x.rules.find((r) => /chas/i.test(r.text))?.text ?? "don't want to chase" : undefined,
    why: mentioned ? '“Don’t chase” is a good instinct, but it needs a distance. Without one, every late entry can be called “not really chasing”.' : 'Momentum entries can drift far from the level; a maximum distance keeps the stop and reward:risk intact.',
    question: 'How far beyond the breakout level are you willing to enter?',
    options: [
      opt(id, 'a', `Within ${a} ${unit}`, 'Example distance — set your own', 'Do not enter more than {v} points beyond the breakout level', 'entry', 'D', { input: { label: 'Maximum distance', unit: 'points', key: 'maxExtensionPoints', placeholder: String(a), defaultValue: a }, primitive: { type: 'max_extension', level: lvl, points: a } }),
      opt(id, 'b', `Within ${b} ${unit}`, 'Example distance — set your own', 'Do not enter more than {v} points beyond the breakout level', 'entry', 'D', { input: { label: 'Maximum distance', unit: 'points', key: 'maxExtensionPoints', placeholder: String(b), defaultValue: b }, primitive: { type: 'max_extension', level: lvl, points: b } }),
      opt(id, 'retest', 'Wait for a retest', 'Enter only when price comes back to the level', 'Enter only on a retest of the breakout level that holds', 'entry', 'B', { primitive: { type: 'retest_hold', level: lvl } }),
      opt(id, 'close', 'Entry only on candle close', `Enter on the ${x.tf} close, never intrabar`, `Enter only on the close of the ${x.tf} breakout candle`, 'entry', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' } }),
      opt(id, 'atr', 'ATR-based maximum extension', 'Distance scales with volatility', 'Do not enter more than 0.5× ATR(14) beyond the breakout level', 'entry', 'D', { primitive: { type: 'max_extension', level: lvl, atrMult: 0.5 } }),
    ],
    recommend: { optionIds: [`${id}:a`], reasoning: `A fixed maximum distance turns “don’t chase” into a yes/no check at the moment of entry. ${a} ${unit} is only an example — choose the distance that keeps your stop and target workable.` },
    testable: true,
  };
}

function entryItem(x: Ctx): ItemSeed | null {
  if (x.breakoutFamily) return null; // the breakout definition is the trigger
  const TRIGGER = /close|candle|break|cross|engulf|limit order|market order|stop order|tick (?:above|below)|reclaim|wick/i;
  const traderEntries = x.rules.filter((r) => (r.section === 'entry' || r.section === 'confirmation') && r.provenance !== 'inferred');
  if (traderEntries.some((r) => TRIGGER.test(r.text) && r.measurable)) return null;
  const id = 'entryTrigger';
  const lvl = primaryEdge(x);
  const down = x.dir === 'short';
  if (/\breject/i.test(x.text)) {
    return {
      id,
      category: 'entryTrigger',
      title: `What counts as a rejection of ${x.levelName}?`,
      dnaKey: 'entry',
      priority: 1,
      required: true,
      subjective: true,
      originalText: x.rules.find((r) => /reject/i.test(r.text))?.text,
      why: `“Rejects ${x.levelName}” is the whole setup — but a wick through, a close back, or two closes away are different trades.`,
      question: 'What counts as a rejection?',
      options: [
        opt(id, 'wick', `Wick through ${x.levelName}, close back ${down ? 'below' : 'above'}`, 'Price probes the level and fails', `A ${x.tf} candle trades ${down ? 'above' : 'below'} ${x.levelName} and closes back ${down ? 'below' : 'above'} it`, 'entry', 'B', { primitive: { type: 'sweep', level: lvl }, tradeoff: 'Earliest entry; more failed rejections.' }),
        opt(id, 'touchclose', `Touch, then a ${down ? 'bearish' : 'bullish'} close`, 'Touch of the level followed by a candle closing away', `Price touches ${x.levelName} and the next ${x.tf} candle closes ${down ? 'down' : 'up'}`, 'entry', 'B', { primitive: { type: 'all', of: [{ type: 'touch', level: lvl }, { type: 'candle_dir' }] } }),
        opt(id, 'two', `Two closes ${down ? 'below' : 'above'} after the test`, 'Slower, stronger confirmation', `After testing ${x.levelName}, two consecutive ${x.tf} candles close ${down ? 'below' : 'above'} it`, 'entry', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'trade_dir' }, tradeoff: 'Fewer false signals; the entry is further from the level.' }),
      ],
      recommend: { optionIds: [`${id}:wick`], reasoning: `A probe through ${x.levelName} that closes back is the most direct version of “rejects” — and it gives a clear stop just beyond the probe.` },
      testable: true,
    };
  }
  const concept = [...x.ids].map((i) => conceptById(i)).find((c) => c?.entry);
  const options: ResolveOption[] = [];
  if (concept?.entry) options.push(opt(id, 'concept', 'Defined by your setup', 'Built from the concept you described', concept.entry(x.c), 'entry', 'B'));
  if (x.ids.has('pullback') || x.ids.has('trend_continuation')) {
    options.push(opt(id, 'resume', 'First candle resuming the trend', 'After the pullback, the first candle that closes back in the trend direction', `Enter on the first ${x.tf} candle that closes back in the trend direction after the pullback`, 'entry', 'B', { primitive: { type: 'pullback_resume', bars: 3 } }));
    options.push(opt(id, 'break', 'Break of the pullback candle', `Enter when price breaks the ${down ? 'low' : 'high'} of the last pullback candle`, `Enter when price trades ${down ? 'below the low' : 'above the high'} of the last pullback candle`, 'entry', 'B', { primitive: { type: 'pullback_resume', bars: 2 } }));
  }
  if (x.ids.has('scalping') || x.ids.has('momentum')) {
    options.push(opt(id, 'momentum', 'Momentum candle close', 'Close near the extreme of a strong candle', `Enter on the close of a ${x.tf} candle that closes in the top 25% of its range in the trade direction`, 'entry', 'D', { primitive: { type: 'close_location', pct: 25 } }));
    options.push(opt(id, 'microbreak', 'Break of the previous candle', 'Enter as price takes out the prior candle', `Enter when price breaks the previous ${x.tf} candle’s ${down ? 'low' : 'high'}`, 'entry', 'B', { primitive: { type: 'directional_candles', count: 2 } }));
  }
  if (!options.length) options.push(opt(id, 'close', 'Candle close in the trade direction', 'The simplest objective trigger', `Enter on the first ${x.tf} candle that closes in the trade direction after the setup`, 'entry', 'B', { primitive: { type: 'candle_dir' } }));
  return {
    id,
    category: 'entryTrigger',
    title: 'Entry trigger',
    dnaKey: 'entry',
    priority: 1,
    required: true,
    why: 'The plan describes the idea but not the exact moment you enter — without it, entries drift earlier or later from trade to trade.',
    question: 'What exactly triggers the entry?',
    options,
    recommend: { optionIds: [options[0].id], reasoning: x.ids.has('pullback') ? 'Waiting for the first candle that resumes the trend avoids buying a pullback that is still falling.' : 'This trigger is the most direct measurable version of what you described.' },
    testable: true,
  };
}

function stopItem(x: Ctx): ItemSeed | null {
  if (x.has('stop') || x.s.stopPoints != null) return null;
  const id = 'stop';
  const concept = [...x.ids].map((i) => conceptById(i)).filter((c) => c?.stop).sort((a, b) => (b?.specificity ?? 0) - (a?.specificity ?? 0))[0];
  const structureText = concept?.stop ? concept.stop(x.c) : 'Stop 1 tick beyond the swing that formed the setup';
  const [, typical] = x.pts;
  const scalp = x.ids.has('scalping');
  const options = [
    opt(id, 'structure', 'Structure based', 'Beyond the swing / level that proves the idea wrong', /^stop/i.test(structureText) ? structureText : `Stop ${structureText.charAt(0).toLowerCase()}${structureText.slice(1)}`, 'stop', 'B'),
    opt(id, 'fixed', 'Fixed points', `Example: ${typical}-point ${x.inst ?? ''} stop — set your own`.replace('  ', ' '), 'Stop {v} points from entry', 'stop', 'C', { input: { label: 'Stop distance', unit: 'points', key: 'stopPoints', placeholder: String(typical), defaultValue: typical } }),
    opt(id, 'candle', 'Candle based', 'Beyond the confirmation / signal candle', 'Stop 1 tick beyond the confirmation candle', 'stop', 'B'),
    opt(id, 'atr', 'ATR / volatility based', 'Stop distance adapts to current volatility', 'Stop 1.5× ATR(14) from entry', 'stop', 'D'),
  ];
  const entryDesc = x.ids.has('morning_range') ? 'after a morning-high breakout' : x.ids.has('orb') ? 'on an opening-range breakout' : /reject/i.test(x.text) ? `on a rejection of ${x.levelName}` : x.ids.has('pullback') ? 'on a pullback in a trend' : x.ids.has('liquidity_sweep') ? 'after a sweep' : 'at your setup';
  return {
    id,
    category: 'stop',
    title: 'Stop loss',
    dnaKey: 'stop',
    priority: 2,
    required: true,
    critical: true,
    why: 'Your strategy does not currently define where the trade becomes invalid. Without this, the setup cannot be tested consistently — and risk on every trade is undefined.',
    question: 'How should your stop be defined?',
    options,
    recommend: scalp
      ? { optionIds: [`${id}:fixed`], reasoning: 'Scalps repeat many times a session; a fixed, pre-set stop keeps every attempt the same size so the results can be compared.' }
      : { optionIds: [`${id}:structure`], reasoning: `You enter ${entryDesc}. Placing the stop beyond that structure keeps the invalidation tied to the reason you entered rather than an arbitrary distance.` },
    testable: true,
  };
}

function targetItem(x: Ctx): ItemSeed | null {
  if (x.has('target') || x.s.minRR != null) return null;
  const id = 'target';
  const concept = [...x.ids].map((i) => conceptById(i)).filter((c) => c?.target).sort((a, b) => (b?.specificity ?? 0) - (a?.specificity ?? 0))[0];
  const [a] = x.pts;
  const scalp = x.ids.has('scalping');
  const reversion = ['mean_reversion', 'range', 'reversal', 'liquidity_sweep'].some((i) => x.ids.has(i)) || /reject/i.test(x.text);
  const options = [
    opt(id, '2r', '2R', 'Twice the distance to your stop', 'Take profit at 2R', 'target', 'C', { values: { minRR: 2 } }),
    opt(id, '1.5r', '1.5R', 'Closer target, hit more often', 'Take profit at 1.5R', 'target', 'C', { values: { minRR: 1.5 } }),
    opt(id, '3r', '3R', 'Further target, hit less often', 'Take profit at 3R', 'target', 'C', { values: { minRR: 3 } }),
    ...(concept?.target ? [opt(id, 'structure', 'Structural target', 'The next level your setup points to', concept.target(x.c), 'target', 'B')] : []),
    opt(id, 'points', 'Fixed points', `Example: ${a * 2} points — set your own`, 'Take profit {v} points from entry', 'target', 'C', { input: { label: 'Target distance', unit: 'points', key: 'targetPoints', placeholder: String(a * 2), defaultValue: a * 2 } }),
  ];
  const rec = scalp ? `${id}:points` : reversion && concept?.target ? `${id}:structure` : `${id}:2r`;
  return {
    id,
    category: 'target',
    title: 'Profit target',
    dnaKey: 'target',
    priority: 4,
    required: true,
    why: 'No exit is defined for winning trades, so every exit is decided in the moment — winners are easy to cut early or give back.',
    question: 'Where do you take profit?',
    options,
    recommend: {
      optionIds: [rec],
      reasoning: scalp ? 'A fixed points target matches a fixed scalp stop, so every trade has the same reward:risk.' : reversion ? 'Your idea is a return toward a level — targeting that level matches what the setup expects to happen.' : 'A 2R first target keeps the reward clearly larger than the risk without needing an unusually large move.',
    },
    testable: true,
  };
}

function invalidationItem(x: Ctx): ItemSeed | null {
  if (x.has('invalidation')) return null;
  const id = 'invalidation';
  const concept = [...x.ids].map((i) => conceptById(i)).filter((c) => c?.invalidation).sort((a, b) => (b?.specificity ?? 0) - (a?.specificity ?? 0))[0];
  const lvl = primaryEdge(x);
  const options = [
    ...(concept?.invalidation ? [opt(id, 'concept', 'Price closes back through the level', 'Your setup level fails before entry', concept.invalidation(x.c), 'invalidation', 'B', { primitive: { type: 'close_beyond', level: lvl, side: 'against_dir' } })] : []),
    opt(id, 'time', 'No follow-through in time', 'The setup expires if nothing happens', `Setup is void if the entry does not trigger within 3 ${x.tf} candles of the setup`, 'invalidation', 'D'),
    opt(id, 'extreme', 'New extreme against the trade', 'A new low (long) / high (short) beyond the setup', 'Setup is void if price makes a new extreme beyond the setup swing before entry', 'invalidation', 'B'),
  ];
  return {
    id,
    category: 'invalidation',
    title: 'Trade invalidation',
    dnaKey: 'invalidation',
    priority: 3,
    required: true,
    why: 'Nothing says when the setup is no longer valid — without it, a failed setup can still be entered late.',
    question: 'When is the setup cancelled before you enter?',
    options,
    recommend: { optionIds: [options[0].id], reasoning: `If ${x.levelName} fails before your entry conditions complete, the reason for the trade is gone.` },
    testable: true,
  };
}

function contextItem(x: Ctx): ItemSeed | null {
  if (x.rules.some((r) => (r.section === 'context' || r.section === 'bias') && r.provenance === 'trader' && !/^(trade|scalp|watch|use)\b/i.test(r.text))) return null;
  if (x.ids.has('scalping') && !x.ids.has('trend_continuation')) return null; // scalps react to the moment; context is optional
  const id = 'marketContext';
  const up = x.dir !== 'short';
  const options = [
    opt(id, 'structure', `${up ? 'Higher highs + higher lows' : 'Lower highs + lower lows'} (15-minute)`, 'Trade only with the short-term trend', `At least 2 ${up ? 'higher highs and higher lows' : 'lower highs and lower lows'} on the 15-minute chart`, 'bias', 'D', { primitive: { type: 'trend_structure', swings: 2 } }),
    opt(id, 'prevclose', `${up ? 'Above' : 'Below'} the prior day's close`, 'A simple daily bias filter', `Price is ${up ? 'above' : 'below'} the previous day's closing price`, 'bias', 'C'),
    ...(x.ids.has('vwap') || x.ids.has('morning_range') ? [opt(id, 'vwap', `${up ? 'Above' : 'Below'} VWAP`, 'Session VWAP as the dividing line', `Price is ${up ? 'above' : 'below'} the session VWAP`, 'context', 'D', { primitive: { type: 'close_beyond', level: { kind: 'vwap' }, side: 'trade_dir' } })] : []),
    opt(id, 'none', 'No context filter', 'Take every valid setup regardless of trend', 'No market-context filter (every valid setup qualifies)', 'context', 'A'),
  ];
  return {
    id,
    category: 'marketContext',
    title: 'Market context',
    dnaKey: 'context',
    priority: 6,
    required: !x.ids.has('order_flow'),
    why: /reject/i.test(x.text) ? 'A VWAP rejection in a down-trending session and one in a strong up-trend are different trades; the plan does not say which conditions qualify.' : 'The plan does not say what the market should look like before the setup counts.',
    question: 'What market conditions must be in place?',
    options,
    multiSelect: true,
    recommend: { optionIds: [`${id}:structure`], reasoning: 'Requiring swing structure in your direction filters counter-trend setups using price alone — no new tool needed.' },
    testable: true,
  };
}

function windowItem(x: Ctx): ItemSeed | null {
  const { start, end } = x.s.tradingWindow;
  if (start && end) return null;
  if (start && !end) {
    const [h, m] = start.split(':').map(Number);
    const add = (mins: number) => `${String(Math.floor((h * 60 + m + mins) / 60)).padStart(2, '0')}:${String((h * 60 + m + mins) % 60).padStart(2, '0')}`;
    const choices = [45, 75, 105].map(add);
    const id = 'timeCutoff';
    return {
      id,
      category: 'timeCutoff',
      title: 'Time cutoff',
      dnaKey: 'session',
      priority: 7,
      required: true,
      why: `You start at ${formatClock(start)} but never stop. Setups found late in the session behave differently from the ones this plan describes.`,
      question: 'When do you stop taking new entries?',
      options: choices.map((c) => opt(id, c, `No new entries after ${formatClock(c)}`, `Window ${formatClock(start)} – ${formatClock(c)} ET`, `No new entries after ${formatClock(c)} ET`, null, 'C', { values: { windowStart: start, windowEnd: c } })),
      recommend: { optionIds: [`${id}:${choices[0]}`], reasoning: x.ids.has('morning_range') || x.ids.has('orb') ? 'Morning breakouts get most of their follow-through in the first hour; later breaks are a different setup.' : 'A cutoff keeps the plan to the conditions you start in.' },
    };
  }
  const id = 'timeWindow';
  const presets: [string, string, string][] = x.ids.has('scalping')
    ? [
        ['09:30', '11:00', 'Highest liquidity'],
        ['09:30', '11:30', 'Opening session'],
        ['13:30', '15:30', 'Afternoon session'],
      ]
    : /reject|fade|range|revers/i.test(x.text)
      ? [
          ['10:00', '15:00', 'After the opening drive'],
          ['10:30', '15:00', 'Once the day has settled'],
          ['09:45', '11:30', 'Morning only'],
        ]
      : [
          ['09:45', '11:30', 'Morning session'],
          ['10:00', '15:00', 'Most of the day, after the open'],
          ['09:30', '15:30', 'Full session except the last 30 minutes'],
        ];
  return {
    id,
    category: 'timeWindow',
    title: 'Time window',
    dnaKey: 'session',
    priority: 7,
    required: true,
    why: 'Without a time window the setup can be taken in conditions it was never designed for.',
    question: 'When are you allowed to enter?',
    options: presets.map(([s, e, d]) => opt(id, `${s}-${e}`, `${formatClock(s)} – ${formatClock(e)} ET`, d, `Only take entries between ${formatClock(s)} and ${formatClock(e)} ET`, null, 'C', { values: { windowStart: s, windowEnd: e } })),
    recommend: { optionIds: [`${id}:${presets[0][0]}-${presets[0][1]}`], reasoning: x.ids.has('scalping') ? 'Scalps need the tight spreads and volume of the first 90 minutes.' : /reject|fade|range/i.test(x.text) ? 'Rejections work best once the opening drive is over and price is rotating around its levels.' : 'Trend and breakout setups get their best follow-through in the morning session.' },
  };
}

function tradeLimitItem(x: Ctx): ItemSeed | null {
  if (x.s.maxTrades != null || x.has('maxTrades')) return null;
  const id = 'tradeLimit';
  const scalp = x.ids.has('scalping');
  const nums = scalp ? [3, 5, 8] : [1, 2, 3];
  const rec = scalp ? 5 : x.ids.has('morning_range') || x.ids.has('orb') ? 2 : 2;
  return {
    id,
    category: 'tradeLimit',
    title: 'Maximum trades',
    dnaKey: 'noTrade',
    priority: 8,
    required: true,
    why: 'Nothing in the plan ends the trading day, so a loss can be followed by another attempt, and another.',
    question: 'How many attempts per day?',
    options: nums.map((n) => opt(id, String(n), `${n} trade${n === 1 ? '' : 's'} per day`, n === 1 ? 'One shot — no second attempt' : `Up to ${n} attempts`, `Maximum ${n} trade${n === 1 ? '' : 's'} per day`, 'maxTrades', 'C', { values: { maxTrades: n } })),
    recommend: { optionIds: [`${id}:${rec}`], reasoning: scalp ? 'Scalps repeat; a hard cap stops the count growing after losses.' : x.ids.has('morning_range') || x.ids.has('orb') ? 'A level usually breaks meaningfully once; two attempts allow one retry without turning it into revenge trading.' : 'Two attempts allow one retry after a stop-out without encouraging revenge trades.' },
  };
}

function riskItem(x: Ctx): ItemSeed | null {
  if (x.has('risk')) return null;
  const id = 'positionSizing';
  return {
    id,
    category: 'positionSizing',
    title: 'Risk per trade',
    dnaKey: 'stop',
    priority: 2,
    required: true,
    why: 'Position size is not tied to risk, so one trade can be much larger than the others.',
    question: 'How much do you risk on each trade?',
    options: [
      opt(id, 'dollars', 'Fixed dollar risk', 'Same $ loss at your stop every time', 'Risk ${v} per trade; contracts = risk ÷ (stop distance × point value)', 'risk', 'C', { input: { label: 'Risk per trade', unit: '$', key: 'riskDollars', placeholder: '200' } }),
      opt(id, 'percent', '% of account', 'Risk scales with the account', 'Risk {v}% of the account per trade', 'risk', 'C', { input: { label: 'Risk per trade', unit: '%', key: 'riskPercent', placeholder: '0.5', defaultValue: 0.5 } }),
      opt(id, 'contracts', 'Fixed contracts', 'Same size every trade', 'Trade {v} contract(s) per trade', 'risk', 'C', { input: { label: 'Contracts', unit: 'contracts', key: 'contracts', placeholder: '1', defaultValue: 1 } }),
    ],
    recommend: { optionIds: [`${id}:dollars`], reasoning: 'A fixed dollar risk keeps every loss the same size no matter where the stop is — Prop Guard can then check it against your account rules.' },
  };
}

function managementItem(x: Ctx): ItemSeed | null {
  if (x.has('management')) return null;
  const id = 'management';
  return {
    id,
    category: 'management',
    title: 'Trade management',
    dnaKey: 'management',
    priority: 10,
    required: false,
    why: 'Optional: what you do between entry and exit.',
    question: 'How do you manage the trade once it is open?',
    options: [
      opt(id, 'none', 'Set and forget', 'Stop and target only', 'No management — leave the stop and target in place', 'management', 'C'),
      opt(id, 'be', 'Break-even at 1R', 'Move the stop to entry after 1R', 'Move the stop to break-even once the trade is +1R', 'management', 'C'),
      opt(id, 'partial', 'Partial at 1R + runner', 'Take half off at 1R, trail the rest', 'Take half off at 1R and trail the remainder behind each new swing', 'management', 'C'),
    ],
  };
}

function newsItem(x: Ctx): ItemSeed | null {
  if (x.rules.some((r) => /news|cpi|fomc|nfp/i.test(r.text))) return null;
  const id = 'newsFilter';
  return {
    id,
    category: 'newsFilter',
    title: 'News-event filter',
    dnaKey: 'noTrade',
    priority: 9,
    required: false,
    why: 'Optional: scheduled releases can gap through stops regardless of the setup.',
    question: 'Do you avoid trading around scheduled news?',
    options: [
      opt(id, '5', '5 minutes before/after', 'Short blackout', 'No entries 5 minutes before/after scheduled high-impact news (CPI, FOMC, NFP)', 'noTrade', 'C'),
      opt(id, '15', '15 minutes before/after', 'Longer blackout', 'No entries 15 minutes before/after scheduled high-impact news (CPI, FOMC, NFP)', 'noTrade', 'C'),
      opt(id, 'none', 'No news filter', 'Trade through releases', 'No news filter', 'noTrade', 'A'),
    ],
  };
}

function volatilityItem(x: Ctx): ItemSeed | null {
  if (x.rules.some((r) => r.section === 'volatility')) return null;
  if (!(x.breakoutFamily || x.ids.has('scalping') || x.ids.has('mean_reversion'))) return null;
  const id = 'volatilityFilter';
  const options = x.breakoutFamily
    ? [
        opt(id, 'wide', 'Skip very wide ranges', 'The breakout level is too far from a sensible stop', `Skip the setup if the ${x.ids.has('orb') ? 'opening' : 'morning'} range is wider than 2× your stop`, 'volatility', 'D'),
        opt(id, 'narrow', 'Skip very narrow ranges', 'Tiny ranges produce false breaks', `Skip the setup if the ${x.ids.has('orb') ? 'opening' : 'morning'} range is narrower than your stop`, 'volatility', 'D'),
      ]
    : [opt(id, 'quiet', 'Skip quiet markets', 'Not enough movement for the target', 'Skip when the average range of the last 10 candles is smaller than half your target', 'volatility', 'D')];
  options.push(opt(id, 'none', 'No volatility filter', 'Take every valid setup', 'No volatility filter', 'volatility', 'A'));
  return { id, category: 'volatilityFilter', title: 'Volatility filter', dnaKey: 'volatility', priority: 9, required: false, why: 'Optional: very wide or very quiet markets change how the setup behaves.', question: 'Do you skip unusual volatility?', options };
}

// ───────────────────────────── Build items ─────────────────────────────

const PRIORITY_SORT = (a: StrategyRuleItem, b: StrategyRuleItem) => Number(b.required) - Number(a.required) || a.priority - b.priority || Number(b.critical) - Number(a.critical);

function seedsFor(s: StructuredStrategy): ItemSeed[] {
  const x = contextOf(s);
  return [
    ...subjectiveItems(x),
    levelDefinitionItem(x),
    breakoutItem(x),
    entryItem(x),
    instrumentItem(x),
    timeframeItem(x),
    stopItem(x),
    riskItem(x),
    invalidationItem(x),
    targetItem(x),
    chaseItem(x),
    contextItem(x),
    directionItem(x),
    windowItem(x),
    tradeLimitItem(x),
    newsItem(x),
    volatilityItem(x),
    managementItem(x),
  ].filter((i): i is ItemSeed => !!i);
}

const CATEGORY_SECTIONS: Partial<Record<RuleCategory, RuleSection[]>> = {
  stop: ['stop'],
  target: ['target'],
  invalidation: ['invalidation'],
  tradeLimit: ['maxTrades'],
  positionSizing: ['risk'],
  management: ['management'],
  marketContext: ['bias', 'context'],
  entryTrigger: ['entry'],
};

/**
 * The rule-item model for a strategy. Items are derived from the ORIGINAL
 * analysis (what the trader wrote), then marked resolved by the trader's
 * decisions: resolutions here, or AI suggestions accepted in "Why These Changes".
 */
export function buildRuleItems(s: StructuredStrategy): StrategyRuleItem[] {
  const resolutions = new Map((s.resolutions ?? []).map((r) => [r.itemId, r]));
  const accepted = s.aiSuggestedRules.filter((g) => g.status === 'accepted' || g.status === 'edited');
  return seedsFor(s)
    .map((seed): StrategyRuleItem => {
      const res = resolutions.get(seed.id);
      const acceptedFor = !res
        ? accepted.find((g) => (seed.category === 'subjective' ? g.kind === 'objectify' && g.original === seed.originalText : CATEGORY_SECTIONS[seed.category]?.includes(g.section) ?? (seed.category === 'timeWindow' || seed.category === 'timeCutoff' ? g.section === 'window' : false)))
        : undefined;
      const status = res ? 'resolved' : acceptedFor ? 'suggested' : seed.subjective ? 'subjective' : 'missing';
      return {
        id: seed.id,
        category: seed.category,
        title: seed.title,
        originalText: seed.originalText,
        normalizedRule: res?.ruleText ?? (acceptedFor ? (acceptedFor.status === 'edited' && acceptedFor.editedText) || acceptedFor.suggestedRule : undefined),
        status,
        source: res ? res.source : acceptedFor ? 'ai_approved' : seed.subjective ? 'user' : undefined,
        confidence: res ? seed.options.find((o) => res.optionIds.includes(o.id))?.confidence : acceptedFor?.confidence,
        required: seed.required,
        critical: !!seed.critical,
        subjective: !!seed.subjective,
        resolved: status === 'resolved' || status === 'suggested',
        priority: seed.priority,
        why: seed.why,
        question: seed.question,
        options: seed.options,
        multiSelect: !!seed.multiSelect,
        aiRecommendation: seed.recommend,
        selectedOption: res?.optionIds,
        customValue: res?.customValue,
        testable: seed.testable ?? false,
        dnaKey: seed.dnaKey,
      };
    })
    .sort(PRIORITY_SORT);
}

export const openItems = (items: StrategyRuleItem[]) => items.filter((i) => !i.resolved);
export const nextItem = (items: StrategyRuleItem[]) => openItems(items).sort(PRIORITY_SORT)[0] ?? null;

// ───────────────────────────── Resolving ─────────────────────────────

export interface ResolveInput {
  optionIds: string[];
  /** Value typed for options with an input (points, $, %…). */
  inputValue?: number;
  /** The trader's own definition (custom rule). */
  customText?: string;
}

const fill = (t: string, v: number | undefined) => (v == null ? t.replace(/\{v\}/g, '?') : t.replace(/\{v\}/g, String(v)));

/** Parse structured values from a custom definition where possible (times, numbers, symbols). */
function valuesFromCustom(item: StrategyRuleItem, text: string): ResolutionValues {
  const t = text.trim();
  const num = Number(/(\d+(?:\.\d+)?)/.exec(t)?.[1]);
  const clock = (s: string) => {
    const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(s);
    if (!m) return undefined;
    let h = Number(m[1]);
    if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (!m[3] && h < 7) h += 12;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  };
  switch (item.category) {
    case 'instrument':
      return /^[A-Z0-9]{1,4}$/i.test(t) ? { instrument: t.toUpperCase() } : {};
    case 'timeframe': {
      const m = /(\d+)\s*-?\s*(m|min|minute|h|hour)/i.exec(t);
      return m ? { timeframe: `${m[1]}${/h/i.test(m[2]) ? 'h' : 'm'}` } : {};
    }
    case 'tradeLimit':
      return Number.isFinite(num) && num > 0 ? { maxTrades: Math.round(num) } : {};
    case 'timeCutoff': {
      const end = clock(t);
      return end ? { windowEnd: end } : {};
    }
    case 'timeWindow': {
      const parts = t.split(/[-–]|to|until/i).map(clock);
      return parts[0] && parts[1] ? { windowStart: parts[0], windowEnd: parts[1] } : {};
    }
    case 'levelDefinition':
      return Number.isFinite(num) && num > 0 && num <= 240 ? { rangeMinutes: num } : {};
    default:
      return {};
  }
}

function sectionForCategory(c: RuleCategory, item: StrategyRuleItem): RuleSection | null {
  switch (c) {
    case 'stop':
      return 'stop';
    case 'target':
    case 'riskReward':
      return 'target';
    case 'invalidation':
      return 'invalidation';
    case 'marketContext':
      return 'context';
    case 'entryTrigger':
    case 'chaseProtection':
      return 'entry';
    case 'breakoutDefinition':
    case 'retest':
      return 'confirmation';
    case 'tradeLimit':
      return 'maxTrades';
    case 'positionSizing':
      return 'risk';
    case 'management':
      return 'management';
    case 'newsFilter':
      return 'noTrade';
    case 'volatilityFilter':
      return 'volatility';
    case 'levelDefinition':
    case 'subjective':
      return item.dnaKey === 'bias' ? 'bias' : item.dnaKey === 'entry' ? 'entry' : item.dnaKey === 'confirmation' ? 'confirmation' : 'setup';
    default:
      return null;
  }
}

/** Build the trader's decision for an item (nothing is applied until it is stored on the strategy). */
/** Combine multi-select criteria into one rule ("X AND a 5-minute candle closes…"), keeping symbols like ES capitalised. */
export const joinCriteria = (parts: string[]) => parts.map((t, i) => (i > 0 && /^[A-Z](?:[\s\d-]|[a-z])/.test(t) ? t[0].toLowerCase() + t.slice(1) : t)).join(' AND ');

export function makeResolution(item: StrategyRuleItem, input: ResolveInput, now = new Date().toISOString()): RuleResolution {
  if (input.customText?.trim()) {
    const text = input.customText.trim();
    return {
      itemId: item.id,
      category: item.category,
      optionIds: [],
      customValue: text,
      source: 'custom',
      ruleText: text,
      section: sectionForCategory(item.category, item),
      values: valuesFromCustom(item, text),
      replaces: item.subjective ? item.originalText : undefined,
      resolvedAt: now,
    };
  }
  const chosen = item.options.filter((o) => input.optionIds.includes(o.id));
  if (!chosen.length) throw new Error('Choose at least one option or write your own rule.');
  const values: ResolutionValues = {};
  const primitives: Primitive[] = [];
  const value = input.inputValue ?? chosen.find((o) => o.input)?.input?.defaultValue;
  for (const o of chosen) {
    Object.assign(values, o.values ?? {});
    if (o.input && value != null) values[o.input.key] = value as never;
    // The trader's own number replaces the example in the structured condition.
    if (o.primitive?.type === 'max_extension' && value != null) primitives.push({ ...o.primitive, points: value });
    else if (o.primitive) primitives.push(o.primitive);
  }
  const primitive: Primitive | undefined = primitives.length > 1 ? { type: 'all', of: primitives } : primitives[0];
  const ruleText = joinCriteria(chosen.map((o) => fill(o.ruleText, value)));
  return {
    itemId: item.id,
    category: item.category,
    optionIds: chosen.map((o) => o.id),
    inputValue: value,
    source: 'ai_approved',
    ruleText,
    section: chosen[0].section ?? sectionForCategory(item.category, item),
    values,
    primitive,
    replaces: item.subjective ? item.originalText : undefined,
    resolvedAt: now,
  };
}

export function setResolution(s: StructuredStrategy, r: RuleResolution): StructuredStrategy {
  return { ...s, resolutions: [...(s.resolutions ?? []).filter((x) => x.itemId !== r.itemId), r] };
}

export function clearResolution(s: StructuredStrategy, itemId: string): StructuredStrategy {
  return { ...s, resolutions: (s.resolutions ?? []).filter((x) => x.itemId !== itemId) };
}

/**
 * Apply the trader's resolutions: resolved rules join the strategy (labelled
 * AI SUGGESTION — APPROVED or CUSTOM RULE), resolved subjective phrases are
 * replaced by their definitions, structured values (instrument, window,
 * limits, stop/target) are set, superseded pending suggestions drop out, and
 * every analysis stage (DNA, definition score, regimes…) is recomputed.
 */
export function applyResolutions(s: StructuredStrategy): StructuredStrategy {
  const res = s.resolutions ?? [];
  if (!res.length) return s;
  const replaced = new Set(res.map((r) => r.replaces).filter(Boolean) as string[]);
  const rangeRes = res.find((r) => r.values.rangeMinutes != null);
  // The trader's words stay (it is their idea); they are marked as defined by the resolution.
  let rules = allRulesOf(s).map((r) => {
    const by = r.provenance === 'trader' ? res.find((x) => x.replaces === r.text) : undefined;
    return by ? { ...r, vagueTerms: [], measurable: true, definedBy: by.itemId } : r;
  });
  // A resolved range length replaces the "length not stated" interpretation.
  if (rangeRes) rules = rules.filter((r) => !(r.provenance === 'inferred' && /^(Morning (high|low)|Opening range) =/.test(r.text)));
  for (const r of res) {
    if (!r.section) continue;
    const rule = makeRule(r.section, r.ruleText, r.source === 'custom' ? 'trader' : 'suggested', undefined, s.originalText, true);
    rules.push({ ...rule, id: `res_${r.itemId}`, origin: r.source, ruleItemId: r.itemId, ...(r.primitive ? { primitive: r.primitive } : {}) });
  }
  const v = <K extends keyof ResolutionValues>(k: K) => res.find((r) => r.values[k] != null)?.values[k];
  const instrument = v('instrument');
  const direction = v('direction');
  const timeframe = v('timeframe');
  const windowStart = v('windowStart');
  const windowEnd = v('windowEnd');
  const targetPoints = v('targetPoints');
  const stopPoints = s.stopPoints ?? v('stopPoints') ?? null;
  const minRR = s.minRR ?? v('minRR') ?? (targetPoints != null && stopPoints ? Math.round((targetPoints / stopPoints) * 100) / 100 : null);
  const sectionsResolved = new Set(res.map((r) => r.section).filter(Boolean));
  const windowResolved = windowStart != null || windowEnd != null;
  const suggestions = s.aiSuggestedRules.filter(
    (g) => g.status !== 'pending' || !((g.section === 'window' && windowResolved) || (g.section !== 'window' && sectionsResolved.has(g.section) && g.kind !== 'objectify') || (g.kind === 'objectify' && g.original && replaced.has(g.original))),
  );
  const tw = s.tradingWindow;
  return finalizeStructured(
    {
      ...s,
      instrument: instrument && !s.instrument.length ? [instrument] : s.instrument,
      direction: direction ?? s.direction,
      directionSource: direction ? 'trader' : s.directionSource,
      timeframes: timeframe && !s.timeframes.includes(timeframe) ? [timeframe, ...s.timeframes] : s.timeframes,
      tradingWindow: windowResolved ? { start: tw.start ?? windowStart ?? null, end: tw.end ?? windowEnd ?? null, provenance: tw.provenance ?? 'suggested' } : tw,
      maxTrades: s.maxTrades ?? v('maxTrades') ?? null,
      stopPoints,
      minRR,
      session: s.session || (windowResolved && (windowStart ?? tw.start ?? '') < '16:00' ? 'New York' : s.session),
      aiSuggestedRules: suggestions,
      unresolvedQuestions: s.unresolvedQuestions.map((q) =>
        q.variable === 'instrument' && instrument ? { ...q, answer: instrument } : q.variable === 'timeframe' && timeframe ? { ...q, answer: timeframe } : q.variable === 'openingRangeMinutes' && rangeRes ? { ...q, answer: String(rangeRes.values.rangeMinutes) } : q,
      ),
      definitions: {
        ...s.definitions,
        ...(rangeRes ? { rangeMinutes: rangeRes.values.rangeMinutes } : {}),
        ...(v('riskDollars') != null ? { riskDollars: v('riskDollars') } : {}),
        ...(v('riskPercent') != null ? { riskPercent: v('riskPercent') } : {}),
        ...(v('contracts') != null ? { contracts: v('contracts') } : {}),
      },
    },
    rules,
    s.behavioralRisks,
    { attempts: s.uniqueness?.attempts },
  );
}

// ───────────────────────────── Progress, ownership, readiness ─────────────────────────────

export interface ResolveProgress {
  total: number;
  resolved: number;
  requiredOpen: number;
  criticalOpen: StrategyRuleItem[];
  next: StrategyRuleItem | null;
}

export function resolveProgress(items: StrategyRuleItem[]): ResolveProgress {
  const relevant = items.filter((i) => i.required || i.resolved);
  return {
    total: relevant.length,
    resolved: relevant.filter((i) => i.resolved).length,
    requiredOpen: items.filter((i) => i.required && !i.resolved).length,
    criticalOpen: items.filter((i) => i.critical && !i.resolved),
    // The guided flow walks the required rules; optional refinements stay in the list.
    next: nextItem(items.filter((i) => i.required)),
  };
}

export interface StrategyOwnership {
  traderPct: number;
  aiApprovedPct: number;
  propGuardPct: number;
  customRules: number;
  aiApprovedRules: number;
}

/**
 * Who defined the final plan, counted per rule (a long Prop Guard definition
 * does not outweigh a short trader rule): rules the trader wrote (stated or
 * custom) vs Prop Guard options the TRADER APPROVED vs Prop Guard's own
 * interpretations of the trader's terms.
 */
export function strategyOwnership(resolved: StructuredStrategy, finalRules: StrategyRule[]): StrategyOwnership {
  let trader = 0;
  let ai = 0;
  let pg = 0;
  for (const r of finalRules) {
    if (/^Direction:/.test(r.text)) continue;
    if (r.provenance === 'trader') trader += 1;
    else if (r.provenance === 'suggested') ai += 1;
    else pg += 0.5; // interpretations / definitions of the trader's own terms
  }
  // Structured choices: stated by the trader, or approved resolutions.
  const res = resolved.resolutions ?? [];
  const fieldRes = res.filter((x) => !x.section);
  for (const x of fieldRes) {
    if (x.source === 'custom') trader += 1;
    else ai += 1;
  }
  const statedFields = [resolved.instrument.length > 0 && !res.some((x) => x.category === 'instrument'), resolved.directionSource === 'trader' && !res.some((x) => x.category === 'direction'), resolved.tradingWindow.provenance === 'trader', resolved.stopPoints != null && !res.some((x) => x.category === 'stop'), resolved.maxTrades != null && !res.some((x) => x.category === 'tradeLimit')];
  trader += statedFields.filter(Boolean).length;
  const total = trader + ai + pg || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return {
    traderPct: pct(trader),
    aiApprovedPct: pct(ai),
    propGuardPct: Math.max(0, 100 - pct(trader) - pct(ai)),
    customRules: finalRules.filter((r) => r.origin === 'custom').length,
    aiApprovedRules: finalRules.filter((r) => r.provenance === 'suggested').length,
  };
}

export interface TestReadiness {
  ready: boolean;
  core: { label: string; done: boolean }[];
  optionalOpen: string[];
  requiredOpen: StrategyRuleItem[];
}

const CORE: { label: string; done: (r: StructuredStrategy, items: StrategyRuleItem[]) => boolean }[] = [
  { label: 'Instrument', done: (r) => r.instrument.length > 0 },
  { label: 'Market context', done: (r, items) => r.biasRules.some((x) => x.provenance !== 'inferred') || r.contextRules.length > 0 || !items.some((i) => i.category === 'marketContext') },
  { label: 'Setup', done: (r) => r.setupRules.some((x) => x.provenance !== 'inferred') || r.entryRules.some((x) => x.provenance === 'trader') || r.contextRules.length > 0 },
  { label: 'Entry', done: (r) => r.entryRules.length > 0 || r.confirmationRules.length > 0 },
  { label: 'Confirmation', done: (r, items) => r.confirmationRules.length > 0 || r.entryRules.some((x) => x.measurable) || !items.some((i) => i.category === 'breakoutDefinition') },
  { label: 'Stop', done: (r) => r.stopRules.length > 0 || r.stopPoints != null },
  { label: 'Target', done: (r) => r.targetRules.length > 0 || r.minRR != null },
  { label: 'Invalidation', done: (r) => r.invalidationRules.length > 0 },
  { label: 'Risk', done: (r) => r.riskRules.some((x) => x.section === 'risk') },
  { label: 'Time window', done: (r) => !!(r.tradingWindow.start && r.tradingWindow.end) },
  { label: 'Trade limit', done: (r) => r.maxTrades != null },
];

/** "Strategy test ready" — every required rule is defined (stated, resolved or approved). */
export function testReadiness(resolved: StructuredStrategy, items: StrategyRuleItem[]): TestReadiness {
  const core = CORE.map((c) => ({ label: c.label, done: c.done(resolved, items) }));
  const requiredOpen = items.filter((i) => i.required && !i.resolved);
  return {
    ready: requiredOpen.length === 0 && core.every((c) => c.done),
    core,
    optionalOpen: items.filter((i) => !i.required && !i.resolved).map((i) => i.title),
    requiredOpen,
  };
}

// ───────────────────────────── Final rule sheet ─────────────────────────────

export type SheetOrigin = 'YOUR RULE' | 'AI SUGGESTION — APPROVED' | 'CUSTOM RULE' | 'AI INTERPRETATION';

export interface RuleSheetSection {
  key: string;
  title: string;
  lines: { text: string; origin: SheetOrigin }[];
}

const originOf = (r: StrategyRule): SheetOrigin => (r.origin === 'custom' ? 'CUSTOM RULE' : r.provenance === 'trader' ? 'YOUR RULE' : r.provenance === 'suggested' ? 'AI SUGGESTION — APPROVED' : 'AI INTERPRETATION');

/** The finished strategy as a clean rule sheet, every line labelled with its origin. */
export function finalRuleSheet(resolved: StructuredStrategy, finalRules: StrategyRule[]): RuleSheetSection[] {
  const res = resolved.resolutions ?? [];
  const fieldOrigin = (cat: RuleCategory, trader: boolean): SheetOrigin => {
    const r = res.find((x) => x.category === cat);
    return r ? (r.source === 'custom' ? 'CUSTOM RULE' : 'AI SUGGESTION — APPROVED') : trader ? 'YOUR RULE' : 'AI INTERPRETATION';
  };
  const lines = (pred: (r: StrategyRule) => boolean) => finalRules.filter(pred).map((r) => ({ text: r.text, origin: originOf(r) }));
  const isChase = (r: StrategyRule) => r.ruleItemId === 'chaseProtection' || /chas/i.test(r.text);
  const isRetest = (r: StrategyRule) => /re-?test/i.test(r.text) && !isChase(r);
  const tw = resolved.tradingWindow;
  const sections: RuleSheetSection[] = [
    { key: 'market', title: 'Market', lines: resolved.instrument.map((i) => ({ text: i, origin: fieldOrigin('instrument', new RegExp(`\\b${i}\\b`).test(resolved.originalText)) })) },
    { key: 'session', title: 'Session', lines: resolved.session ? [{ text: `${resolved.session}${tw.start && tw.start < '12:00' ? ' morning session' : ''}`.trim(), origin: 'AI INTERPRETATION' }] : [] },
    {
      key: 'direction',
      title: 'Direction',
      lines: resolved.direction ? [{ text: resolved.direction === 'both' ? 'Long and short' : resolved.direction === 'long' ? 'Long only' : 'Short only', origin: fieldOrigin('direction', resolved.directionSource === 'trader') }] : [],
    },
    {
      key: 'window',
      title: 'Time window',
      lines: tw.start || tw.end ? [{ text: tw.start && tw.end ? `${formatClock(tw.start)} – ${formatClock(tw.end)} ET` : tw.start ? `After ${formatClock(tw.start)} ET` : `Until ${formatClock(tw.end!)} ET`, origin: tw.provenance === 'trader' && !res.some((r) => r.category === 'timeWindow') ? 'YOUR RULE' : fieldOrigin(res.some((r) => r.category === 'timeWindow') ? 'timeWindow' : 'timeCutoff', tw.provenance === 'trader') }] : [],
    },
    { key: 'timeframe', title: 'Timeframe', lines: resolved.timeframes.map((t) => ({ text: TIMEFRAME_WORD(t), origin: fieldOrigin('timeframe', new RegExp(t.replace('m', '')).test(resolved.originalText)) })) },
    { key: 'context', title: 'Market context', lines: lines((r) => (r.section === 'bias' || r.section === 'context') && !/^Direction:/.test(r.text)) },
    { key: 'setup', title: 'Setup', lines: lines((r) => r.section === 'setup' || r.section === 'volume') },
    { key: 'entry', title: 'Entry', lines: lines((r) => (r.section === 'entry' || r.section === 'confirmation') && !isChase(r) && !isRetest(r)) },
    { key: 'chase', title: 'Chase rule', lines: lines(isChase) },
    { key: 'retest', title: 'Retest', lines: lines(isRetest) },
    { key: 'stop', title: 'Stop', lines: lines((r) => r.section === 'stop') },
    { key: 'target', title: 'Target', lines: lines((r) => r.section === 'target' || r.section === 'management') },
    { key: 'invalidation', title: 'Invalidation', lines: lines((r) => r.section === 'invalidation') },
    { key: 'limit', title: 'Trade limit', lines: resolved.maxTrades != null ? [{ text: `Maximum ${resolved.maxTrades} trade${resolved.maxTrades === 1 ? '' : 's'} per day`, origin: fieldOrigin('tradeLimit', /max|trades? (?:a|per)/i.test(resolved.originalText)) }] : [] },
    { key: 'cutoff', title: 'Time cutoff', lines: tw.end ? [{ text: `No new trades after ${formatClock(tw.end)} ET`, origin: res.some((r) => r.category === 'timeWindow' || r.category === 'timeCutoff') ? fieldOrigin(res.some((r) => r.category === 'timeCutoff') ? 'timeCutoff' : 'timeWindow', false) : tw.provenance === 'trader' ? 'YOUR RULE' : 'AI INTERPRETATION' }] : [] },
    { key: 'risk', title: 'Risk', lines: lines((r) => r.section === 'risk') },
    { key: 'filters', title: 'Filters / do not trade', lines: lines((r) => (r.section === 'noTrade' && !isChase(r)) || r.section === 'volatility' || r.section === 'filter') },
  ];
  return sections;
}

// ───────────────────────────── Historical Practice handoff ─────────────────────────────

/** The structured strategy Historical Practice reads (and, later, real historical data). */
export interface PracticeStrategySpec {
  version: 1;
  name: string;
  instrument: string | null;
  direction: 'long' | 'short' | 'both';
  session: string;
  timeframe: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  marketContext: string[];
  setup: string[];
  entry: string[];
  confirmation: string[];
  chase: string[];
  stop: StopSpec;
  target: TargetSpec;
  invalidation: string[];
  risk: { text: string[]; riskDollars?: number; riskPercent?: number; contracts?: number };
  tradeLimit: number | null;
  filters: string[];
  /** Executable rules (compiled by `compileRuleSet`). */
  ruleSet: TestableRuleSet;
}

export function practiceSpecOf(resolved: StructuredStrategy, ruleSet: TestableRuleSet): PracticeStrategySpec {
  const of = (...roles: string[]) => ruleSet.conditions.filter((c) => roles.includes(c.role)).map((c) => c.text);
  const chase = ruleSet.conditions.filter((c) => /chas|beyond the breakout level|retest of the breakout/i.test(c.text)).map((c) => c.text);
  return {
    version: 1,
    name: resolved.name,
    instrument: ruleSet.instrument[0] ?? null,
    direction: ruleSet.direction,
    session: resolved.session,
    timeframe: ruleSet.timeframe,
    timeStart: ruleSet.window?.start ?? resolved.tradingWindow.start,
    timeEnd: ruleSet.window?.end ?? resolved.tradingWindow.end,
    marketContext: of('context', 'bias'),
    setup: [...ruleSet.definitions, ...of('setup', 'volume', 'volatility')],
    entry: of('entry').filter((t) => !chase.includes(t)),
    confirmation: of('confirmation'),
    chase,
    stop: ruleSet.stop,
    target: ruleSet.target,
    invalidation: of('invalidation'),
    risk: { text: resolved.riskRules.filter((r) => r.section === 'risk').map((r) => r.text), ...resolved.definitions },
    tradeLimit: ruleSet.maxTrades,
    filters: of('noTrade'),
    ruleSet,
  };
}
