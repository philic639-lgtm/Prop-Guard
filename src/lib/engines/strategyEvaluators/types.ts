import type { MarketSession } from '../marketTime';

/** Minimal OHLCV bar the evaluators need (NormalizedBar is structurally compatible). */
export interface OhlcvBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Market context derived ONLY from bars up to and including the evaluation bar. */
export interface SessionContext {
  etDate: string;
  minutes: number;
  session: MarketSession;
  /** Index (within the provided bars) of today's first regular-session bar. */
  sessionStartIndex: number;
  prevDay: { high: number; low: number; close: number } | null;
  /** Today's VWAP at each bar from sessionStartIndex..index (aligned to bars). */
  vwapSeries: number[];
  vwap: number | null;
  atr: number | null;
  relativeVolume: number | null;
  gapPct: number | null;
  /** Opening range if it is complete at this bar. */
  openingRange: (minutes: number) => { high: number; low: number; endIndex: number } | null;
  trend: 'up' | 'down' | 'flat';
}

export interface RuleCheck {
  /** Label from the Strategy Library checklist. */
  label: string;
  passed: boolean;
  detail?: string;
}

/** Normalized features describing a setup (for similarity and analytics). */
export interface SetupFeatures {
  timeOfDayMinutes: number;
  session: MarketSession;
  trend: 'up' | 'down' | 'flat';
  orbSize: number | null;
  orbSizeAtr: number | null;
  relativeVolume: number | null;
  vwapDistanceAtr: number | null;
  atr: number | null;
  atrPct: number | null;
  pdRelation: 'above_pdh' | 'below_pdl' | 'inside' | 'unknown';
  gapPct: number | null;
  retestNumber: number;
  breakoutStrength: 'weak' | 'normal' | 'strong';
}

export interface SetupLevel {
  label: string;
  price: number;
  kind: 'orb_high' | 'orb_low' | 'pdh' | 'pdl' | 'support' | 'resistance' | 'swing_high' | 'swing_low' | 'prior_close';
}

export interface SetupSignal {
  strategyId: string;
  strategyVersion: string;
  direction: 'long' | 'short';
  /** True when every rule passed (ideal decision = trade); false = near-miss (ideal = wait). */
  valid: boolean;
  decisionIndex: number;
  decisionTimestamp: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
  checks: RuleCheck[];
  levels: SetupLevel[];
  features: SetupFeatures;
}

export interface EvaluationInput {
  instrument: string;
  /** History up to and including the evaluation bar. Nothing after it is provided. */
  bars: readonly OhlcvBar[];
  context: SessionContext;
}

/**
 * A strategy evaluator built from a Strategy Library template. The same
 * evaluator serves historical scenario generation, (future) backtesting and
 * the live strategy checker: given history up to "now", does the setup
 * trigger on the latest bar?
 */
export interface StrategyEvaluator {
  strategyId: string;
  /** Bump when detection logic changes; stored with every generated scenario. */
  version: string;
  /** ET minutes during which the setup can trigger (lets the scanner skip other bars cheaply). */
  activeWindow: [number, number];
  /** Prior sessions the evaluator needs (previous-day levels, relative volume). */
  lookbackSessions: number;
  evaluate(input: EvaluationInput): SetupSignal | null;
}
