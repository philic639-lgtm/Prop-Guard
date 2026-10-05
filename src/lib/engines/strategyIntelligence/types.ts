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
  | 'volatility'
  | 'volume'
  | 'filter';

/**
 * How much to trust a recommendation.
 * A — derived directly from the trader's rules; B — logical improvement of them;
 * C — common trading principle; D — Prop Guard hypothesis, requires testing;
 * E — validated on historical market data (only ever set from real verified data).
 */
export type ConfidenceLabel = 'A' | 'B' | 'C' | 'D' | 'E';

export const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
  A: 'Derived directly from your rules',
  B: 'Logical improvement',
  C: 'Common trading principle',
  D: 'Suggested by Prop Guard — requires testing',
  E: 'Validated on historical data',
};

/** A reasoned statement with its confidence and (when it comes from the trader) the words it is based on. */
export interface Insight {
  text: string;
  confidence: ConfidenceLabel;
  basis?: string;
}

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
  /** Set when the rule came from resolving a missing rule. */
  origin?: RuleSource;
  /** Resolved rule item this rule answers. */
  ruleItemId?: string;
  /** Trader rule whose subjective wording was defined by this rule item (kept, now defined). */
  definedBy?: string;
  /** Structured condition attached at resolution time (Practice reads it instead of parsing text). */
  primitive?: import('./ruleset').Primitive;
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
  confidence: ConfidenceLabel;
  /** Tools the suggestion brings in that the trader never mentioned (VWAP, EMA, ATR…). Empty when it stays in their vocabulary. */
  introducesTools: string[];
  /**
   * strategy — part of THIS strategy's logic; account — an account-wide protection (news blackout, risk sizing)
   * that applies to every strategy. Account items are offered separately and are not part of the strategy's identity.
   */
  scope: 'strategy' | 'account';
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

export type DnaKey =
  | 'market'
  | 'timeframe'
  | 'setup'
  | 'context'
  | 'bias'
  | 'entry'
  | 'confirmation'
  | 'invalidation'
  | 'stop'
  | 'target'
  | 'management'
  | 'session'
  | 'volatility'
  | 'volume'
  | 'noTrade';

/** One component of the strategy's decomposition — in the trader's words where they gave them. */
export interface DnaComponent {
  key: DnaKey;
  label: string;
  values: { text: string; provenance: RuleProvenance; origin?: RuleSource; definedBy?: string }[];
}

/** Why the strategy should work and where it can break — about the IDEA, never the trader. */
export interface StrategyReasoning {
  exploits: Insight[];
  assumptions: Insight[];
  falseSignals: Insight[];
  earlyEntry: Insight[];
  lateEntry: Insight[];
  subjectiveDiscretion: Insight[];
  overtrading: Insight[];
  riskReward: Insight[];
  regimeThreats: Insight[];
}

export type MarketRegime = 'trending' | 'ranging' | 'high_volatility' | 'low_volatility' | 'breakout' | 'mean_reversion' | 'news_driven' | 'opening_session' | 'late_session';

export interface RegimeAssessment {
  regime: MarketRegime;
  label: string;
  fit: 'designed_for' | 'avoid' | 'neutral';
  reasons: string[];
  confidence: ConfidenceLabel;
}

export interface RiskLevel {
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface WeaknessReport {
  strengths: string[];
  weaknesses: string[];
  missingRules: string[];
  contradictions: Insight[];
  ambiguity: Insight[];
  overfittingRisk: RiskLevel;
  executionRisk: RiskLevel;
  /** Behavioral risks built into the plan (see `behavioralRisks`). */
  psychologicalRisk: RiskLevel;
  failureScenarios: Insight[];
}

export interface UniquenessReport {
  /** Most similar library template whose concept the trader did NOT use (drift target). */
  closestForeignTemplate: { id: string; name: string; similarity: number } | null;
  /** Most similar previously analysed strategy (different text). */
  closestPrevious: { name: string; similarity: number } | null;
  /** Share of the improved strategy that comes from the trader's own words. */
  identityRetention: number;
  passes: boolean;
  /** 1 = first pass was unique enough; 2 = regenerated in preserve mode. */
  attempts: number;
  notes: string[];
}

// ───────────────────────────── Resolve Missing Rules ─────────────────────────────

export type RuleCategory =
  | 'instrument'
  | 'direction'
  | 'timeframe'
  | 'subjective'
  | 'levelDefinition'
  | 'breakoutDefinition'
  | 'entryTrigger'
  | 'retest'
  | 'chaseProtection'
  | 'stop'
  | 'target'
  | 'riskReward'
  | 'invalidation'
  | 'marketContext'
  | 'timeWindow'
  | 'timeCutoff'
  | 'tradeLimit'
  | 'positionSizing'
  | 'management'
  | 'newsFilter'
  | 'volatilityFilter';

/** stated — the trader said it; missing — not stated; subjective — stated but not measurable; suggested — an AI suggestion the trader accepted; resolved — defined via Resolve Missing Rules. */
export type ResolvableStatus = 'stated' | 'missing' | 'subjective' | 'suggested' | 'resolved';

/** user — trader's own words; ai — Prop Guard proposal (not yet approved); ai_approved — Prop Guard option the trader chose; custom — trader-written definition. */
export type RuleSource = 'user' | 'ai' | 'ai_approved' | 'custom';

/** Structured values a resolution sets on the strategy. */
export interface ResolutionValues {
  instrument?: string;
  direction?: 'long' | 'short' | 'both';
  timeframe?: string;
  windowStart?: string;
  windowEnd?: string;
  maxTrades?: number;
  stopPoints?: number;
  targetPoints?: number;
  minRR?: number;
  /** Minutes after 9:30 ET that define the opening / morning range. */
  rangeMinutes?: number;
  /** Chase protection: maximum distance beyond the breakout level at entry. */
  maxExtensionPoints?: number;
  riskDollars?: number;
  riskPercent?: number;
  contracts?: number;
}

export interface ResolveOption {
  id: string;
  label: string;
  /** Example / what it means. */
  detail: string;
  /** Short trade-off (earlier vs later entry, more vs fewer signals…). */
  tradeoff?: string;
  /** The rule as it will read in the strategy. `{v}` is replaced by the trader's value. */
  ruleText: string;
  section: RuleSection | null;
  values?: ResolutionValues;
  /** Value the trader types (e.g. points); its unit and which value key it fills. */
  input?: { label: string; unit: string; key: keyof ResolutionValues; placeholder: string; defaultValue?: number };
  primitive?: import('./ruleset').Primitive;
  confidence: ConfidenceLabel;
}

/** One rule of the strategy in the Resolve Missing Rules model. */
export interface StrategyRuleItem {
  id: string;
  category: RuleCategory;
  title: string;
  /** The trader's words this item is about (subjective phrases, stated rules). */
  originalText?: string;
  /** The rule as it currently reads (stated / resolved). */
  normalizedRule?: string;
  status: ResolvableStatus;
  source?: RuleSource;
  confidence?: ConfidenceLabel;
  required: boolean;
  /** Critical risk rule (stop) — shown in red while missing. */
  critical: boolean;
  subjective: boolean;
  resolved: boolean;
  /** 1 (entry/setup ambiguity) … 10 (optional refinements). */
  priority: number;
  /** Why this rule matters for THIS strategy. */
  why: string;
  question: string;
  options: ResolveOption[];
  multiSelect: boolean;
  aiRecommendation?: { optionIds: string[]; reasoning: string };
  selectedOption?: string[];
  customValue?: string;
  testable: boolean;
  /** DNA row this item belongs to. */
  dnaKey: DnaKey;
}

/** The trader's explicit decision for one rule item. */
export interface RuleResolution {
  itemId: string;
  category: RuleCategory;
  optionIds: string[];
  customValue?: string;
  inputValue?: number;
  source: 'ai_approved' | 'custom';
  ruleText: string;
  section: RuleSection | null;
  values: ResolutionValues;
  primitive?: import('./ruleset').Primitive;
  /** Trader rule this resolution replaces (subjective phrases). */
  replaces?: string;
  resolvedAt: string;
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
  volatilityRules: StrategyRule[];
  volumeRules: StrategyRule[];
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
  dna: DnaComponent[];
  reasoning: StrategyReasoning;
  regimes: RegimeAssessment[];
  weaknessReport: WeaknessReport;
  uniqueness: UniquenessReport | null;
  /** Saved with the strategy so Practice / backtests use the trader's final rules. */
  testableRules?: import('./ruleset').TestableRuleSet;
  /** Decisions made in Resolve Missing Rules (applied on top of the analysis). */
  resolutions?: RuleResolution[];
  /** Snapshot of the rule-item model at save time. */
  ruleItems?: StrategyRuleItem[];
  /** Definitions the trader resolved (e.g. the morning-range length). */
  definitions?: { rangeMinutes?: number; riskDollars?: number; riskPercent?: number; contracts?: number };
  /** Structured strategy handed to Historical Practice. */
  practiceSpec?: import('./resolve').PracticeStrategySpec;
  analysisSource: 'ai' | 'local';
  analyzedAt: string;
}
