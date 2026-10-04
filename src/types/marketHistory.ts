import type { HistoricalTradeOutcome } from '@/lib/engines/historicalOutcomeEngine';
import type { RuleCheck, SetupFeatures, SetupLevel } from '@/lib/engines/strategyEvaluators/types';

/**
 * Market-history layer: a scenario frozen at its decision bar, generated from
 * stored bars by the shared strategy evaluators. `preBars` (up to and
 * including the decision) and `postBars` (strictly after) are kept apart so
 * the future can be withheld until the trader locks a decision.
 */
export interface ScenarioBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalScenario {
  id: string;
  instrument: string;
  timeframe: string;
  strategyId: string;
  strategyName: string;
  strategyVersion: string;
  /** Data provider id (databento, csv:…, mock). */
  provider: string;
  /** True only when bars came from a verified market-data provider. */
  verified: boolean;
  /** True for recorded market data (verified or not); false for simulated bars. */
  historical: boolean;
  etDate: string;
  marketSession: string;
  scenarioStart: string;
  decisionTimestamp: string;
  scenarioEnd: string;
  direction: 'long' | 'short';
  /** Every rule passed → ideal decision is to trade; otherwise WAIT/SKIP. */
  valid: boolean;
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
  checks: RuleCheck[];
  levels: SetupLevel[];
  features: SetupFeatures;
  preBars: ScenarioBar[];
  postBars: ScenarioBar[];
  /** VWAP aligned to preBars + postBars (null outside the regular session). */
  vwap: (number | null)[];
  outcome: HistoricalTradeOutcome;
}
