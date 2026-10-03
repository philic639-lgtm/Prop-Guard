import type { ChecklistItem, InstrumentSymbol, Strategy } from '@/types/domain';

/**
 * Curated, EDUCATIONAL strategy templates. These are structures to adapt and
 * test — they are never presented as profitable or recommended trades.
 */
export type StrategyStyle = 'breakout' | 'pullback' | 'reversal' | 'trend';
export type Complexity = 'Beginner' | 'Intermediate' | 'Advanced';

export interface LibraryTemplate {
  id: string;
  name: string;
  summary: string;
  markets: InstrumentSymbol[];
  session: string;
  timeframes: string;
  stopMethod: string;
  targetStyle: string;
  complexity: Complexity;
  style: StrategyStyle;
  /** Typical trades per day the structure produces. */
  tradesPerDay: number;
  /** When the setup typically occurs. */
  timing: 'open' | 'morning' | 'any';
  /** Typical ES-equivalent stop range in points. */
  stopRange: [number, number];
  needsConfirmation: boolean;
  rules: string[];
  checklist: string[];
  defaults: Pick<
    Strategy,
    | 'entryWindowStart'
    | 'entryWindowEnd'
    | 'biasRequirement'
    | 'requiresBiasAlignment'
    | 'entryTrigger'
    | 'confirmationRules'
    | 'retestRules'
    | 'targetMethod'
    | 'minRR'
    | 'maxTrades'
    | 'invalidationRules'
    | 'timeframe'
  >;
}

export const STRATEGY_LIBRARY: LibraryTemplate[] = [
  {
    id: 'orb-15',
    name: '15M ORB',
    summary: 'Trade a confirmed break of the first 15-minute range in the direction of the higher-timeframe bias, entering on a retest.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'NY Open',
    timeframes: '15m range · 5m confirm · 1m entry',
    stopMethod: 'Beyond the retest candle or inside the range',
    targetStyle: 'Fixed 2R or prior high/low',
    complexity: 'Beginner',
    style: 'breakout',
    tradesPerDay: 1,
    timing: 'open',
    stopRange: [4, 8],
    needsConfirmation: true,
    rules: [
      'Mark the 9:30–9:45 ET high and low.',
      'Only trade in the direction of the 1H bias.',
      'Wait for a 5-minute candle to close outside the range.',
      'Enter on a retest within three 1-minute candles.',
      'Minimum 1:2 reward to risk.',
    ],
    checklist: ['ORB established', 'Breakout confirmed', '5-minute candle closed', 'Retest occurred'],
    defaults: {
      timeframe: '15m / 5m / 1m',
      entryWindowStart: '09:45',
      entryWindowEnd: '10:45',
      biasRequirement: '1H trend',
      requiresBiasAlignment: true,
      entryTrigger: '5-minute candle closes outside the opening range',
      confirmationRules: '5-minute candle body closes beyond the ORB high/low',
      retestRules: 'Retest of the broken level within three 1-minute candles',
      targetMethod: '2R fixed target',
      minRR: 2,
      maxTrades: 1,
      invalidationRules: 'Price closes back inside the range on the 5-minute chart',
    },
  },
  {
    id: 'orb-5',
    name: '5M ORB',
    summary: 'A faster opening-range break using the first 5 minutes. More signals, more noise — requires strict size discipline.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'NY Open',
    timeframes: '5m range · 1m entry',
    stopMethod: 'Opposite side of the 5m range or midpoint',
    targetStyle: '1.5–2R',
    complexity: 'Intermediate',
    style: 'breakout',
    tradesPerDay: 2,
    timing: 'open',
    stopRange: [3, 6],
    needsConfirmation: true,
    rules: ['Mark the 9:30–9:35 ET range.', 'Enter on a 1-minute close outside the range.', 'Stop at range midpoint.', 'No entries after 10:15 ET.'],
    checklist: ['5M range marked', '1-minute close outside range', 'Volume expanding'],
    defaults: {
      timeframe: '5m / 1m',
      entryWindowStart: '09:35',
      entryWindowEnd: '10:15',
      biasRequirement: 'Pre-market bias',
      requiresBiasAlignment: true,
      entryTrigger: '1-minute close outside the 5-minute range',
      confirmationRules: 'Expanding volume on the breakout candle',
      retestRules: 'Optional',
      targetMethod: '1.5R–2R',
      minRR: 1.5,
      maxTrades: 2,
      invalidationRules: 'Close back inside the range',
    },
  },
  {
    id: 'vwap-reclaim',
    name: 'VWAP Reclaim',
    summary: 'After price loses VWAP, wait for a decisive reclaim and hold, then trade continuation back toward the day’s range extreme.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'NY Morning',
    timeframes: '5m structure · 1m entry',
    stopMethod: 'Below the reclaim candle low',
    targetStyle: 'Prior swing high or 2R',
    complexity: 'Intermediate',
    style: 'reversal',
    tradesPerDay: 2,
    timing: 'morning',
    stopRange: [4, 7],
    needsConfirmation: true,
    rules: ['Price must trade below VWAP first.', 'Reclaim on a 5-minute close above VWAP.', 'Enter on first hold of VWAP.', 'Avoid if VWAP is flat and choppy.'],
    checklist: ['Traded through VWAP', '5-minute close reclaiming VWAP', 'Held VWAP on pullback'],
    defaults: {
      timeframe: '5m / 1m',
      entryWindowStart: '09:45',
      entryWindowEnd: '11:30',
      biasRequirement: 'Session bias',
      requiresBiasAlignment: false,
      entryTrigger: 'First successful hold of VWAP after reclaim',
      confirmationRules: '5-minute candle closes back above/below VWAP',
      retestRules: 'Pullback holds VWAP',
      targetMethod: 'Prior swing or 2R',
      minRR: 2,
      maxTrades: 2,
      invalidationRules: '5-minute close back through VWAP',
    },
  },
  {
    id: 'vwap-rejection',
    name: 'VWAP Rejection',
    summary: 'In a trending session, fade a test of VWAP from the trend side when price rejects it cleanly.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'NY Morning',
    timeframes: '5m trend · 1m entry',
    stopMethod: 'Beyond VWAP plus buffer',
    targetStyle: 'Session high/low',
    complexity: 'Intermediate',
    style: 'trend',
    tradesPerDay: 2,
    timing: 'morning',
    stopRange: [3, 6],
    needsConfirmation: true,
    rules: ['Session must be trending away from VWAP.', 'Wait for first touch of VWAP.', 'Enter on a rejection candle.', 'Skip the third test.'],
    checklist: ['Trend day structure', 'First or second VWAP test', 'Rejection candle formed'],
    defaults: {
      timeframe: '5m / 1m',
      entryWindowStart: '10:00',
      entryWindowEnd: '12:00',
      biasRequirement: 'Trend direction',
      requiresBiasAlignment: true,
      entryTrigger: 'Rejection candle at VWAP',
      confirmationRules: 'Wick rejection with close back in trend direction',
      retestRules: 'N/A',
      targetMethod: 'Session extreme',
      minRR: 2,
      maxTrades: 2,
      invalidationRules: 'Close through VWAP',
    },
  },
  {
    id: 'opening-drive',
    name: 'Opening Drive',
    summary: 'Join a strong, one-directional open after the first pullback fails to retrace meaningfully.',
    markets: ['ES', 'NQ', 'MES', 'MNQ'],
    session: 'NY Open',
    timeframes: '1m · 5m',
    stopMethod: 'Below the first pullback low',
    targetStyle: 'Trail or 2R',
    complexity: 'Advanced',
    style: 'trend',
    tradesPerDay: 1,
    timing: 'open',
    stopRange: [5, 10],
    needsConfirmation: false,
    rules: ['Open must drive without overlap for 5+ minutes.', 'Enter on the first shallow pullback.', 'One attempt only.'],
    checklist: ['Strong directional open', 'Shallow first pullback', 'No overlap with prior candles'],
    defaults: {
      timeframe: '1m / 5m',
      entryWindowStart: '09:35',
      entryWindowEnd: '10:00',
      biasRequirement: 'Opening direction',
      requiresBiasAlignment: true,
      entryTrigger: 'First pullback holds above 50% of the drive',
      confirmationRules: 'Momentum resumes',
      retestRules: 'N/A',
      targetMethod: 'Trail or 2R',
      minRR: 2,
      maxTrades: 1,
      invalidationRules: 'Pullback retraces more than 50% of the drive',
    },
  },
  {
    id: 'breakout-retest',
    name: 'Breakout + Retest',
    summary: 'Trade a clean break of a well-defined level, entering only after the level is retested and holds.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'Any liquid session',
    timeframes: '15m levels · 5m entry',
    stopMethod: 'Back through the retested level',
    targetStyle: 'Next level or 2R',
    complexity: 'Beginner',
    style: 'breakout',
    tradesPerDay: 2,
    timing: 'any',
    stopRange: [4, 8],
    needsConfirmation: true,
    rules: ['Level must be marked before the session.', 'Break must close beyond the level.', 'Enter on retest hold.'],
    checklist: ['Pre-marked level', 'Close beyond level', 'Retest held'],
    defaults: {
      timeframe: '15m / 5m',
      entryWindowStart: null,
      entryWindowEnd: null,
      biasRequirement: 'Higher timeframe trend',
      requiresBiasAlignment: true,
      entryTrigger: 'Retest of broken level holds',
      confirmationRules: 'Candle closes beyond the level',
      retestRules: 'Retest within 3 candles of the entry timeframe',
      targetMethod: 'Next key level or 2R',
      minRR: 2,
      maxTrades: 2,
      invalidationRules: 'Close back through the level',
    },
  },
  {
    id: 'trend-pullback',
    name: 'Trend Pullback',
    summary: 'In an established trend, enter on a pullback to a moving average or prior structure.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'Any liquid session',
    timeframes: '15m trend · 5m entry',
    stopMethod: 'Beyond the pullback swing',
    targetStyle: 'Prior high/low or 2R',
    complexity: 'Beginner',
    style: 'pullback',
    tradesPerDay: 2,
    timing: 'any',
    stopRange: [4, 8],
    needsConfirmation: true,
    rules: ['Higher highs and higher lows (or inverse).', 'Pullback to the 20 EMA or prior structure.', 'Entry on a reversal candle in trend direction.'],
    checklist: ['Trend structure intact', 'Pullback to EMA/structure', 'Reversal candle in trend direction'],
    defaults: {
      timeframe: '15m / 5m',
      entryWindowStart: null,
      entryWindowEnd: null,
      biasRequirement: '15m trend',
      requiresBiasAlignment: true,
      entryTrigger: 'Reversal candle at pullback zone',
      confirmationRules: 'Close in trend direction',
      retestRules: 'N/A',
      targetMethod: 'Prior swing or 2R',
      minRR: 2,
      maxTrades: 2,
      invalidationRules: 'Break of the last higher low / lower high',
    },
  },
  {
    id: 'sr-reversal',
    name: 'Support / Resistance Reversal',
    summary: 'Fade a pre-marked level only after a clear rejection — never by anticipation.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'Any liquid session',
    timeframes: '1H levels · 5m entry',
    stopMethod: 'Beyond the rejection wick',
    targetStyle: 'Mid-range or 2R',
    complexity: 'Intermediate',
    style: 'reversal',
    tradesPerDay: 2,
    timing: 'any',
    stopRange: [3, 6],
    needsConfirmation: true,
    rules: ['Only trade levels marked before the session.', 'Require a rejection candle.', 'No trades against a strong trend day.'],
    checklist: ['Pre-marked level', 'Rejection candle', 'Not a trend day'],
    defaults: {
      timeframe: '1H / 5m',
      entryWindowStart: null,
      entryWindowEnd: null,
      biasRequirement: 'Range context',
      requiresBiasAlignment: false,
      entryTrigger: 'Rejection candle at level',
      confirmationRules: 'Close back inside the level',
      retestRules: 'N/A',
      targetMethod: 'Mid-range or 2R',
      minRR: 2,
      maxTrades: 2,
      invalidationRules: 'Acceptance beyond the level',
    },
  },
  {
    id: 'liquidity-sweep',
    name: 'Liquidity Sweep Reversal',
    summary: 'After price runs an obvious high or low and quickly reclaims it, trade the failed move back into range.',
    markets: ['ES', 'MES', 'NQ', 'MNQ'],
    session: 'NY Open / London close',
    timeframes: '5m · 1m',
    stopMethod: 'Beyond the sweep extreme',
    targetStyle: 'Opposite side of range',
    complexity: 'Advanced',
    style: 'reversal',
    tradesPerDay: 1,
    timing: 'open',
    stopRange: [4, 9],
    needsConfirmation: true,
    rules: ['Identify obvious prior high/low.', 'Price must sweep and close back inside.', 'Enter on structure shift.'],
    checklist: ['Obvious liquidity level swept', 'Close back inside', 'Structure shift on 1m'],
    defaults: {
      timeframe: '5m / 1m',
      entryWindowStart: '09:30',
      entryWindowEnd: '11:00',
      biasRequirement: 'Context',
      requiresBiasAlignment: false,
      entryTrigger: '1-minute structure shift after sweep',
      confirmationRules: 'Close back inside the swept level',
      retestRules: 'Optional',
      targetMethod: 'Opposite side of range',
      minRR: 2,
      maxTrades: 1,
      invalidationRules: 'New extreme beyond the sweep',
    },
  },
  {
    id: 'momentum-continuation',
    name: 'Momentum Continuation',
    summary: 'After a strong impulse, trade a tight flag break in the same direction.',
    markets: ['NQ', 'MNQ', 'ES', 'MES'],
    session: 'NY Morning',
    timeframes: '5m · 1m',
    stopMethod: 'Below the flag low',
    targetStyle: 'Measured move',
    complexity: 'Intermediate',
    style: 'trend',
    tradesPerDay: 2,
    timing: 'morning',
    stopRange: [3, 7],
    needsConfirmation: true,
    rules: ['Impulse leg with expanding range.', 'Tight consolidation of 3–8 candles.', 'Enter on flag break close.'],
    checklist: ['Strong impulse', 'Tight flag', 'Close through flag'],
    defaults: {
      timeframe: '5m / 1m',
      entryWindowStart: '09:45',
      entryWindowEnd: '11:30',
      biasRequirement: 'Impulse direction',
      requiresBiasAlignment: true,
      entryTrigger: 'Flag break close',
      confirmationRules: 'Volume expansion on break',
      retestRules: 'N/A',
      targetMethod: 'Measured move',
      minRR: 1.5,
      maxTrades: 2,
      invalidationRules: 'Flag low breaks',
    },
  },
];

export function getTemplate(id: string): LibraryTemplate | undefined {
  return STRATEGY_LIBRARY.find((t) => t.id === id);
}

export function checklistFromLabels(labels: string[], idPrefix: string): ChecklistItem[] {
  return labels.map((label, i) => ({ id: `${idPrefix}_${i}`, label, kind: 'yesno', required: true }));
}
