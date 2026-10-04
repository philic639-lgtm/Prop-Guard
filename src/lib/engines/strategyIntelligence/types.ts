/**
 * Strategy Intelligence types.
 *
 * Every rule carries its provenance so the app can always show the difference
 * between what the TRADER said, what Prop Guard INTERPRETED from standard
 * definitions, and what Prop Guard SUGGESTS (never applied until accepted).
 */

export type RuleSection =
  | 'bias'
  | 'context'
  | 'setup'
  | 'entry'
  | 'confirmation'
  | 'stop'
  | 'target'
  | 'management'
  | 'invalidation'
  | 'noTrade'
  | 'risk'
  | 'maxTrades'
  | 'window'
  | 'timeframe'
  | 'filter';

/** trader — stated in the description; inferred — standard interpretation of what they said; suggested — Prop Guard proposal. */
export type RuleProvenance = 'trader' | 'inferred' | 'suggested';

export interface StrategyRule {
  id: string;
  section: RuleSection;
  text: string;
  provenance: RuleProvenance;
  /** Exact words from the original description that this rule comes from. */
  quote?: string;
  /** Has a measurable threshold, event or anchor (and no subjective wording). */
  measurable: boolean;
  /** Subjective words found in the rule. */
  vagueTerms: string[];
  /** For accepted / edited suggestions. */
  suggestionId?: string;
}

/** Open-ended: well-known ids are listed in `concepts.ts`; anything else is "custom". */
export type StrategyStyleId = string;

export interface DetectedStyle {
  id: StrategyStyleId;
  label: string;
  /** 0–1 — how strongly the description points at this style. */
  confidence: number;
  /** Trader words that triggered the classification. */
  evidence: string[];
}

export interface TradingWindow {
  start: string | null;
  end: string | null;
  provenance: RuleProvenance | null;
  quote?: string;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface StrategySuggestion {
  id: string;
  section: RuleSection;
  /** objectify — make a subjective rule measurable; missing — fill a gap; protection — behavioral guard-rail. */
  kind: 'objectify' | 'missing' | 'protection';
  title: string;
  /** What is wrong today. */
  issue: string;
  /** The trader's words this improves (objectify suggestions). */
  original?: string;
  /** The proposed measurable rule. Thresholds are Prop Guard suggestions, not the trader's. */
  suggestedRule: string;
  rationale: string;
  status: SuggestionStatus;
  editedText?: string;
  /** Structured values applied when accepted. */
  apply?: { maxTrades?: number; minRR?: number; windowEnd?: string; windowStart?: string };
}

export interface HealthDimension {
  key: HealthDimensionKey;
  label: string;
  score: number;
  notes: string[];
}

export type HealthDimensionKey = 'ruleClarity' | 'entryPrecision' | 'riskDefinition' | 'exitDefinition' | 'marketContext' | 'repeatability' | 'testability' | 'overtradingProtection';

export interface StrategyHealthScore {
  total: number;
  dimensions: HealthDimension[];
  strengths: string[];
  weaknesses: string[];
  criticalGaps: string[];
}

export type PlanBehavior =
  | 'chasing'
  | 'revenge_trading'
  | 'entering_too_early'
  | 'over_confirmation'
  | 'fomo'
  | 'oversized_risk'
  | 'moving_stops'
  | 'holding_losers'
  | 'cutting_winners_early'
  | 'overtrading'
  | 'trading_chop'
  | 'predicting_not_reacting';

/** A behavioral weakness built into the PLAN — never a statement about the trader. */
export interface BehavioralRisk {
  id: string;
  behavior: PlanBehavior;
  title: string;
  explanation: string;
  mitigation: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ClarifyingQuestion {
  id: string;
  variable: 'instrument' | 'entryTrigger' | 'openingRangeMinutes' | 'timeframe' | 'direction';
  question: string;
  why: string;
  options?: string[];
  answer?: string;
}

export interface StructuredStrategy {
  version: 1;
  originalText: string;
  name: string;
  /** Ordered by confidence. Contains `custom` when nothing known fits. */
  detectedStyle: DetectedStyle[];
  classification: string;
  direction: 'long' | 'short' | 'both' | null;
  /** Whether the direction was stated by the trader or inferred. */
  directionSource: RuleProvenance | null;
  instrument: string[];
  session: string;
  tradingWindow: TradingWindow;
  timeframes: string[];
  biasRules: StrategyRule[];
  contextRules: StrategyRule[];
  setupRules: StrategyRule[];
  entryRules: StrategyRule[];
  confirmationRules: StrategyRule[];
  stopRules: StrategyRule[];
  targetRules: StrategyRule[];
  managementRules: StrategyRule[];
  invalidationRules: StrategyRule[];
  noTradeRules: StrategyRule[];
  riskRules: StrategyRule[];
  filterRules: StrategyRule[];
  maxTrades: number | null;
  stopPoints: number | null;
  minRR: number | null;
  traderProvidedRules: StrategyRule[];
  aiInferredRules: StrategyRule[];
  aiSuggestedRules: StrategySuggestion[];
  unresolvedQuestions: ClarifyingQuestion[];
  missingVariables: string[];
  strategyHealthScore: StrategyHealthScore;
  behavioralRisks: BehavioralRisk[];
  analysisSource: 'ai' | 'local';
  analyzedAt: string;
}
