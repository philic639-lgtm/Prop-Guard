import type { InstrumentSymbol, Strategy } from '@/types/domain';

/**
 * Built-in strategy template schema.
 *
 * Templates are curated, rule-based FRAMEWORKS — structures for a trader to
 * adapt and test. They carry no performance claims: `isBacktested` stays false
 * and `performanceData` null unless real backtest data is attached later.
 * Add a template by adding one `defineTemplate({...})` entry to `catalog.ts`;
 * every screen, filter and the matcher pick it up automatically.
 */

export type StrategyCategory =
  | 'opening_range'
  | 'vwap'
  | 'trend'
  | 'breakout'
  | 'support_resistance'
  | 'previous_day'
  | 'liquidity'
  | 'opening_session';

/** Setup style — what the entry is built around. */
export type StrategyStyle = 'breakout' | 'pullback' | 'reversal' | 'trend' | 'support_resistance';
export type Complexity = 'Beginner' | 'Intermediate' | 'Advanced';
export type SessionKey = 'ny_open' | 'ny_morning' | 'ny_afternoon' | 'london' | 'asia';
export type TimeframeKey = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type MarketCondition = 'trending' | 'range' | 'high_volatility' | 'moderate_volatility' | 'low_volatility' | 'reversal';
export type SetupFrequency = 'frequent' | 'moderate' | 'selective';
export type HoldTime = '1-5' | '5-20' | '20-60' | '60+';
/** Trades with the prevailing move, against it, or either. */
export type TrendAlignment = 'with_trend' | 'counter_trend' | 'either';
/** How the framework is labelled. Never "proven". */
export type FrameworkLabel = 'established' | 'common' | 'rule_based';

/** Real, attributable backtest results — only ever set from actual data. */
export interface TemplatePerformanceData {
  source: string;
  period: string;
  sampleSize: number;
  winRate: number;
  avgR: number;
}

// ---------------------------------------------------------------------------
// Visual examples (educational diagrams; data only — rendered by StrategyVisualExample)
// ---------------------------------------------------------------------------

/** One candle in abstract chart units (0–100). Diagrams are illustrations, not market data. */
export interface VisualCandle {
  o: number;
  h: number;
  l: number;
  c: number;
}

/** A horizontal level (`value`) or a moving line such as VWAP/EMA (`values`, one per candle). */
export interface VisualLine {
  label: string;
  value?: number;
  values?: number[];
}

/** Shaded box, e.g. the opening range. */
export interface VisualZone {
  label: string;
  top: number;
  bottom: number;
  from: number;
  to: number;
}

export interface VisualStage {
  /** 1–5, drawn on the chart. */
  step: number;
  /** Candle index the number is pinned to. */
  candle: number;
  /** Pin the number above the candle's high or below its low. */
  at: 'high' | 'low';
  title: string;
  detail: string;
}

export interface VisualTrade {
  entryCandle: number;
  entry: number;
  stop: number;
  target: number;
}

export interface VisualChart {
  candles: VisualCandle[];
  lines: VisualLine[];
  zones?: VisualZone[];
  stages?: VisualStage[];
  trade?: VisualTrade;
  /** "Don't enter here" marker for common-mistake charts. */
  mistake?: { candle: number; price: number; label: string };
}

/**
 * A real, historical annotated chart. Added later from actual market data —
 * `image` is a bundled asset (require(...)) or a hosted URL.
 */
export interface RealChartExample {
  image: number | string;
  instrument: string;
  timeframe: string;
  date: string;
  caption: string;
  notes?: string[];
}

export interface VisualExample {
  direction: 'long' | 'short';
  rr: number;
  diagram: VisualChart & { stages: VisualStage[]; trade: VisualTrade };
  /** Which rules the example satisfies (defaults to the template checklist). */
  whyItWorks: string[];
  mistake: { title: string; explanation: string; chart: VisualChart };
  realExamples: RealChartExample[];
}

/** Builders receive the template's default R:R so the diagram's target matches the plan. */
export type VisualExampleBuilder = (rr: number) => Omit<VisualExample, 'whyItWorks'> & { whyItWorks?: string[] };

export interface StrategyTemplateInput {
  id: string;
  name: string;
  shortName: string;
  category: StrategyCategory;
  style: StrategyStyle;
  alignment: TrendAlignment;
  framework: FrameworkLabel;
  description: string;
  setup: string;
  rules: string[];
  checklist: string[];
  entryTrigger: string;
  confirmations: string[];
  stopLoss: string;
  profitTarget: string;
  invalidationRules: string[];
  avoidConditions: string[];
  education: string;
  instruments: InstrumentSymbol[];
  sessions: SessionKey[];
  /** Charts used, context → entry. */
  timeframes: TimeframeKey[];
  confirmationTimeframe: TimeframeKey;
  marketConditions: MarketCondition[];
  experienceLevel: Complexity;
  frequency: SetupFrequency;
  holdTimes: HoldTime[];
  defaultRiskReward: number;
  /** Typical stop in ES-equivalent index points (used only for index contracts). */
  stopRange: [number, number];
  entryWindow: [string, string] | null;
  biasRequirement: string;
  requiresBiasAlignment: boolean;
  maxTrades: number;
  tags?: string[];
  popular?: boolean;
  /** Beginner-friendly diagram for the detail page. */
  visual?: VisualExampleBuilder;
}

export interface StrategyTemplate extends Omit<StrategyTemplateInput, 'visual'> {
  visual: VisualExample | null;
  directionTypes: ('long' | 'short')[];
  tags: string[];
  isBuiltIn: true;
  isBacktested: boolean;
  performanceData: TemplatePerformanceData | null;
  // Derived, display-ready fields (also used by the older library screens).
  summary: string;
  markets: InstrumentSymbol[];
  session: string;
  timeframeLabel: string;
  stopMethod: string;
  targetStyle: string;
  complexity: Complexity;
  tradesPerDay: number;
  timing: 'open' | 'morning' | 'any';
  needsConfirmation: boolean;
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

/** Older name kept for existing imports. */
export type LibraryTemplate = StrategyTemplate;

export const CATEGORY_LABEL: Record<StrategyCategory, string> = {
  opening_range: 'Opening Range',
  vwap: 'VWAP',
  trend: 'Trend',
  breakout: 'Breakout',
  support_resistance: 'Support / Resistance',
  previous_day: 'Previous Day Levels',
  liquidity: 'Liquidity / Reversal',
  opening_session: 'Opening Session',
};

export const CATEGORY_ORDER: StrategyCategory[] = [
  'opening_range',
  'vwap',
  'trend',
  'breakout',
  'support_resistance',
  'previous_day',
  'liquidity',
  'opening_session',
];

export const SESSION_LABEL: Record<SessionKey, string> = {
  ny_open: 'NY Open',
  ny_morning: 'NY Morning',
  ny_afternoon: 'NY Afternoon',
  london: 'London',
  asia: 'Asia',
};

export const CONDITION_LABEL: Record<MarketCondition, string> = {
  trending: 'Trending',
  range: 'Range',
  high_volatility: 'High volatility',
  moderate_volatility: 'Moderate volatility',
  low_volatility: 'Low volatility',
  reversal: 'Reversal environment',
};

export const STYLE_LABEL: Record<StrategyStyle, string> = {
  breakout: 'Breakout',
  pullback: 'Pullback',
  reversal: 'Reversal',
  trend: 'Trend following',
  support_resistance: 'Support / Resistance',
};

export const FRAMEWORK_LABEL: Record<FrameworkLabel, string> = {
  established: 'Established Framework',
  common: 'Common Trading Framework',
  rule_based: 'Rule-Based Strategy',
};

export const FREQUENCY_LABEL: Record<SetupFrequency, string> = {
  frequent: 'Frequent (3+ per session)',
  moderate: '1–2 per session',
  selective: 'Selective (0–1 per session)',
};

export const HOLD_LABEL: Record<HoldTime, string> = {
  '1-5': '1–5 min',
  '5-20': '5–20 min',
  '20-60': '20–60 min',
  '60+': '60+ min',
};

export const ALIGNMENT_LABEL: Record<TrendAlignment, string> = {
  with_trend: 'With trend',
  counter_trend: 'Reversal',
  either: 'Either',
};

const TRADES_PER_DAY: Record<SetupFrequency, number> = { frequent: 3, moderate: 2, selective: 1 };

function timingOf(sessions: SessionKey[]): StrategyTemplate['timing'] {
  if (sessions.length === 1 && sessions[0] === 'ny_open') return 'open';
  if (sessions.every((s) => s === 'ny_open' || s === 'ny_morning')) return 'morning';
  return 'any';
}

function buildVisual(input: StrategyTemplateInput): VisualExample | null {
  if (!input.visual) return null;
  const v = input.visual(input.defaultRiskReward);
  return {
    ...v,
    whyItWorks: v.whyItWorks ?? [
      ...input.checklist,
      `Risk defined before entry — stop at the invalidation point, target at 1:${input.defaultRiskReward}.`,
    ],
  };
}

/** Build a template from its input: derives the display fields and strategy defaults. */
export function defineTemplate(input: StrategyTemplateInput): StrategyTemplate {
  const tfLabel = input.timeframes.join(' / ');
  return {
    ...input,
    directionTypes: ['long', 'short'],
    tags: input.tags ?? [],
    isBuiltIn: true,
    isBacktested: false,
    performanceData: null,
    visual: buildVisual(input),
    summary: input.description,
    markets: input.instruments,
    session: input.sessions.map((s) => SESSION_LABEL[s]).join(' · '),
    timeframeLabel: `${tfLabel} · ${input.confirmationTimeframe} confirmation`,
    stopMethod: input.stopLoss,
    targetStyle: input.profitTarget,
    complexity: input.experienceLevel,
    tradesPerDay: TRADES_PER_DAY[input.frequency],
    timing: timingOf(input.sessions),
    needsConfirmation: input.confirmations.length > 0,
    defaults: {
      timeframe: tfLabel,
      entryWindowStart: input.entryWindow?.[0] ?? null,
      entryWindowEnd: input.entryWindow?.[1] ?? null,
      biasRequirement: input.biasRequirement,
      requiresBiasAlignment: input.requiresBiasAlignment,
      entryTrigger: input.entryTrigger,
      confirmationRules: input.confirmations.join('; '),
      retestRules: input.rules.find((r) => /retest/i.test(r)) ?? 'N/A',
      targetMethod: input.profitTarget,
      minRR: input.defaultRiskReward,
      maxTrades: input.maxTrades,
      invalidationRules: input.invalidationRules.join('; '),
    },
  };
}

export const INDEX_FUTURES: InstrumentSymbol[] = ['ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K'];
export const CORE_INDEX: InstrumentSymbol[] = ['ES', 'MES', 'NQ', 'MNQ'];
export const BROAD_FUTURES: InstrumentSymbol[] = [...INDEX_FUTURES, 'CL', 'MCL', 'GC', 'MGC'];
export const ALL_LIQUID: InstrumentSymbol[] = [...BROAD_FUTURES, 'SI', 'HG', '6E', '6B', 'ZN'];
