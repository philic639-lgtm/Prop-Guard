import type { SetupDecision } from '@/lib/engines/setupCheck/decision';
import type { IccSummary } from '@/lib/engines/setupCheck/icc';
import type { InstrumentSpec } from '@/data/instruments';

/**
 * Core domain model for Prop Guard.
 *
 * These types are storage-agnostic: the local store, demo data and the
 * Supabase repositories all map to and from these shapes.
 */

/**
 * Futures root ticker (e.g. "ES", "CL", "6E"). Valid values are the built-in
 * catalog in `src/data/instruments.ts` plus the trader's custom instruments.
 */
export type InstrumentSymbol = string;
export type Direction = 'long' | 'short';
export type Bias = 'bullish' | 'bearish' | 'neutral';

export type TradingType = 'prop' | 'personal' | 'both';

export type DrawdownType = 'static' | 'trailing' | 'eod_trailing';

export type AccountStatus = 'active' | 'passed' | 'failed' | 'archived';

export interface CustomRule {
  id: string;
  label: string;
  description?: string;
}

/** Rules attached to a trading account (prop firm or personal). Always user-configured. */
export interface PropRules {
  dailyLossLimit: number | null;
  maxDrawdown: number | null;
  drawdownType: DrawdownType;
  /** When true, a trailing drawdown stops trailing once the floor reaches the starting balance. */
  trailingLocksAtStart: boolean;
  profitTarget: number | null;
  maxContracts: number | null;
  /** Largest single day may not exceed this % of total profit (e.g. 40 => 40%). */
  consistencyPct: number | null;
  minTradingDays: number | null;
  maxTradingDays: number | null;
  payoutThreshold: number | null;
  custom: CustomRule[];
  /** Further firm terms (payouts, holding, news…). Text / tri-state, always editable. */
  terms?: FirmTerms;
  /**
   * Typed calculations loaded from a VERIFIED firm configuration (absent for
   * hand-entered accounts). Dropped for any rule the trader overrides.
   */
  calc?: AccountRuleCalc;
}

/** Firm-specific calculation details beyond the basic limits (all optional / verified only). */
export interface AccountRuleCalc {
  /** Floor stops trailing at starting balance + offset (e.g. +$100). */
  trailingLockOffset?: number | null;
  /** Max drawdown stated as % of the starting balance. */
  maxDrawdownPct?: number | null;
  drawdownLocksOnPayout?: boolean | null;
  /** `none` = verified: this configuration has no daily loss limit. */
  dailyLossMode?: 'none' | 'fixed' | 'scaling' | null;
  dailyLossBreach?: 'soft' | 'hard' | null;
  dailyLossScaling?: { pct: number; basis: 'peak_eod_profit' | 'peak_eod_balance'; afterBalance: number | null } | null;
  payout?: {
    minRequest: number | null;
    maxRequest: number | null;
    maxRequestPctOfProfit: number | null;
    cycleProfitGoal: number | null;
    minProfitableDays: number | null;
    minDayProfit: number | null;
    maxPayouts: number | null;
    bufferAboveStart: number | null;
  } | null;
  inactivityRule?: string | null;
}

/** 'allowed' | 'not_allowed' | '' (not set). */
export type Permission = 'allowed' | 'not_allowed' | '';

export interface FirmTerms {
  minProfitableDays: number | null;
  payoutFrequency: string;
  payoutRequirements: string;
  scalingRule: string;
  positionLimits: string;
  activationThreshold: string;
  newsTrading: Permission;
  overnight: Permission;
  weekendHolding: Permission;
  copyTrading: Permission;
}

/** Account rule fields that can be imported from the firm rules database (form keys). */
export type FirmRuleField =
  | 'size'
  | 'profitTarget'
  | 'dailyLossLimit'
  | 'maxDrawdown'
  | 'drawdownType'
  | 'maxContracts'
  | 'consistencyPct'
  | 'minTradingDays'
  | 'maxTradingDays'
  | 'minProfitableDays'
  | 'payoutThreshold'
  | 'payoutFrequency'
  | 'payoutRequirements'
  | 'scalingRule'
  | 'positionLimits'
  | 'activationThreshold'
  | 'newsTrading'
  | 'overnight'
  | 'weekendHolding'
  | 'copyTrading';

export type FirmRuleValues = Partial<Record<FirmRuleField, string>>;

/**
 * Where an account's rules came from. `imported` keeps the verified values as
 * imported so edits show as "Custom override"; `custom` = firm not in the database.
 */
export interface AccountFirmLink {
  firmId: string | null;
  programId: string | null;
  programName: string | null;
  stage: 'evaluation' | 'funded' | 'live' | null;
  status: 'verified' | 'unverified' | 'custom';
  ruleVersion: string | null;
  effectiveDate: string | null;
  lastVerifiedAt: string | null;
  importedAt: string | null;
  imported: FirmRuleValues;
  overrides: FirmRuleField[];
  /** Program family ("Trading Combine") and size the trader picked. */
  family?: string | null;
  accountSize?: number | null;
  /** Product line ("LucidPro") and purchase options chosen ({ dll: 'on' }). */
  line?: string | null;
  options?: Record<string, string>;
  /** Purchase / reset date — picks the rule version in force for that account (older terms). */
  purchasedOn?: string | null;
  /** Typed calculations from the verified configuration (see PropRules.calc). */
  calc?: AccountRuleCalc;
  /**
   * The firm rules as they were when the account was saved. Later master-rule
   * updates never rewrite it (nor the account's own rules).
   */
  snapshot?: AccountRuleSnapshot;
}

export interface AccountRuleSnapshotRule {
  key: string;
  label: string;
  value: string;
  status: 'verified' | 'needs_review' | 'unverified';
  sources: { url: string; title?: string; retrievedAt: string; method?: 'page' | 'search_excerpt' }[];
  checkedAt: string;
  note?: string;
  program: string;
  accountSize: number | null;
  stage: 'evaluation' | 'funded' | 'live';
}

export interface AccountRuleSnapshot {
  takenAt: string;
  firmId: string;
  firmName: string;
  programId: string;
  programName: string;
  ruleVersion: string;
  effectiveDate: string;
  lastVerifiedAt: string | null;
  rules: AccountRuleSnapshotRule[];
}

export interface Account {
  id: string;
  name: string;
  firm: string;
  kind: 'prop' | 'personal';
  size: number;
  startingBalance: number;
  balance: number;
  /** Balance at the start of the current evaluation / payout cycle. */
  cycleStartBalance: number;
  /** Highest closed balance, used for trailing drawdown. */
  highWaterMark: number;
  status: AccountStatus;
  rules: PropRules;
  /** Firm / program / rule version the rules were loaded from (absent for older accounts). */
  firmLink?: AccountFirmLink;
  /** Values confirmed from dashboard screenshots (never "live connected"). */
  importState?: AccountImportState;
  createdAt: string;
}

/** Screenshot-import state of an account. Screenshots themselves are never stored. */
export interface AccountImportState {
  /** Non-reversible fingerprint of the account number seen on the dashboard (duplicate detection). */
  fingerprint: string | null;
  /** Masked account number for display, e.g. "••••4917" (only if the trader kept it). */
  maskedId: string | null;
  /** Latest confirmed dashboard values. */
  reported: {
    at: string;
    balance: number | null;
    drawdownThreshold: number | null;
    drawdownRemaining: number | null;
    maxDrawdown: number | null;
    dailyLossLimit: number | null;
  } | null;
  /** Confirmed updates, newest first (capped). */
  history: AccountImportRecord[];
}

export interface AccountImportRecord {
  id: string;
  at: string;
  engine: 'ocr' | 'vision' | 'sample' | 'manual';
  pages: number;
  fields: { key: string; value: number | string; confidence: number | null; source: 'ocr' | 'vision' | 'derived' | 'user'; edited: boolean }[];
  before: { balance: number; highWaterMark: number };
  after: { balance: number; highWaterMark: number };
  notes: string[];
}

/** The trader's personal discipline rules. These apply on top of account rules. */
export interface TradingRules {
  maxRiskPerTrade: number;
  maxTradesPerDay: number;
  /** Personal daily stop expressed as a positive dollar amount. */
  dailyStop: number;
  noRevengeTrades: boolean;
  requireStop: boolean;
  requireTarget: boolean;
  cooldownMinutes: number;
  allowCooldownOverride: boolean;
  maxConsecutiveLosses: number;
  allowStopWidening: boolean;
}

export type ChecklistKind = 'yesno' | 'bias';

export interface ChecklistItem {
  id: string;
  label: string;
  kind: ChecklistKind;
  required: boolean;
}

export type StrategySourceType = 'BUILT_IN' | 'CUSTOM' | 'AI_ADAPTED';

export interface Strategy {
  id: string;
  name: string;
  markets: InstrumentSymbol[];
  session: string;
  timeframe: string;
  /** Entry window in exchange time (ET), 24h HH:mm. */
  entryWindowStart: string | null;
  entryWindowEnd: string | null;
  biasRequirement: string;
  /** Whether trade direction must align with the declared higher-timeframe bias. */
  requiresBiasAlignment: boolean;
  entryTrigger: string;
  confirmationRules: string;
  retestRules: string;
  stopMethod: string;
  typicalStopMin: number | null;
  typicalStopMax: number | null;
  targetMethod: string;
  minRR: number;
  maxTrades: number;
  invalidationRules: string;
  notes: string;
  checklist: ChecklistItem[];
  source: 'custom' | 'library';
  libraryId?: string;
  /**
   * BUILT_IN — one of Prop Guard's curated frameworks, unchanged.
   * CUSTOM — created by the trader (described or built from scratch).
   * AI_ADAPTED — a built-in framework customized by the trader or AI.
   * Older records derive it from `source`.
   */
  sourceType?: StrategySourceType;
  /** The trader's own description, exactly as written (strategies created by "Teach Prop Guard your plan"). */
  originalText?: string;
  /** Strategy Intelligence analysis: provenance-labelled rules, suggestions and health score. */
  structured?: import('@/lib/engines/strategyIntelligence/types').StructuredStrategy;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistAnswer {
  itemId: string;
  label: string;
  value: boolean;
}

export type TradeStatus = 'open' | 'closed' | 'cancelled';
/**
 * How a trade's values entered Prop Guard.
 * - manual / screenshot: journaled by hand (or from a confirmed screenshot)
 * - auto: completed from a pending trade the trader checked in Analyze / Risk Calculator
 * - broker: imported from a connected broker with no manual entry
 */
export type TradeSource = 'manual' | 'screenshot' | 'auto' | 'broker';
export type Emotion = 'calm' | 'confident' | 'anxious' | 'frustrated' | 'fomo' | 'tired';

export interface Trade {
  id: string;
  accountId: string;
  strategyId: string | null;
  sessionId: string | null;
  instrument: InstrumentSymbol;
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  originalStopPrice: number;
  targetPrice: number | null;
  exitPrice: number | null;
  contracts: number;
  riskDollars: number;
  rewardDollars: number | null;
  /** Planned reward:risk multiple. */
  rMultiple: number | null;
  /** Realized R once closed. */
  realizedR: number | null;
  pnl: number | null;
  points: number | null;
  status: TradeStatus;
  openedAt: string;
  closedAt: string | null;
  bias: Bias | null;
  checklist: ChecklistAnswer[];
  rulesFollowed: string[];
  rulesViolated: string[];
  setupScore: number | null;
  setupGrade: SetupGrade | null;
  disciplineScore: number | null;
  notes: string;
  aiSummary: string | null;
  emotion: Emotion | null;
  setupRating: number | null;
  screenshotUri: string | null;
  source: TradeSource;
  journaled: boolean;
  /** Maximum adverse / favorable excursion in points, when known. */
  mae: number | null;
  mfe: number | null;
  /** Trader's own answer to "Did you follow your plan?" (null = not answered). */
  followedPlan?: boolean | null;
  /** Account balance when the trade was planned. */
  accountBalance?: number | null;
  /** Pending trade this was created from (auto-journaling). */
  pendingId?: string | null;
  /** Broker's id for the closed trade — prevents duplicate imports. */
  externalId?: string | null;
  /** Strategy name at the time of the trade (kept if the strategy is later renamed or deleted). */
  strategyName?: string | null;
  /** AI Setup Check this trade was taken from (QUALIFIED / WAIT / STAND DOWN analytics). */
  setupCheckId?: string | null;
}

export type PendingOrigin = 'analyze' | 'calculator' | 'setup_check';
/**
 * pending   — checked, waiting for a result
 * entered   — opened in the live monitor (the live trade owns it now)
 * completed — turned into a journal entry (tradeId set)
 * dismissed — trader said they didn't take it
 */
export type PendingStatus = 'pending' | 'entered' | 'completed' | 'dismissed';

/** Discipline event recorded when a pending trade becomes a real trade. */
export interface PendingRuleEvent {
  type: DisciplineEventType;
  category: DisciplineCategory;
  detail: string;
}

/**
 * Snapshot of a trade the user created or checked in Analyze / Risk Calculator.
 * Holds everything the journal needs so only the result has to be added later
 * (by the trader, a screenshot, or a broker import).
 */
export interface PendingTrade {
  id: string;
  accountId: string;
  strategyId: string | null;
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: number;
  stop: number;
  target: number | null;
  contracts: number;
  accountBalance: number | null;
  riskDollars: number;
  rewardDollars: number | null;
  rr: number | null;
  bias: Bias | null;
  checklist: ChecklistAnswer[];
  rulesFollowed: string[];
  rulesViolated: string[];
  setupScore: number | null;
  setupGrade: SetupGrade | null;
  ruleEvents: PendingRuleEvent[];
  notes: string;
  screenshotUri: string | null;
  origin: PendingOrigin;
  status: PendingStatus;
  tradeId: string | null;
  /** AI Setup Check the trade was planned from. */
  setupCheckId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A trade planned and checked before execution. */
export interface TradePlan {
  id: string;
  accountId: string;
  strategyId: string | null;
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: number;
  stop: number;
  target: number | null;
  contracts: number;
  riskDollars: number;
  rewardDollars: number | null;
  rr: number | null;
  matchPct: number;
  grade: SetupGrade;
  conditionsMet: number;
  conditionsTotal: number;
  notes: string;
  status: 'saved' | 'executed' | 'discarded';
  createdAt: string;
}

/** A strategy practice attempt on a screenshot (never risks capital). */
export interface PracticeRun {
  id: string;
  strategyId: string;
  screenshotUri: string | null;
  answers: Record<string, boolean>;
  matchPct: number;
  conditionsMet: number;
  conditionsTotal: number;
  verdict: 'match' | 'wait' | 'no_trade';
  feedback: string;
  createdAt: string;
}

export type AlertKind =
  | 'good_entry'
  | 'move_stop_breakeven'
  | 'partial_taken'
  | 'take_profit'
  | 'approaching_stop'
  | 'trade_closed'
  | 'risk_limit'
  | 'cooldown';

/** In-app notification feed item (mirrors push notifications). */
export interface AppAlert {
  id: string;
  kind: AlertKind;
  title: string;
  body: string;
  tradeId: string | null;
  at: string;
  read: boolean;
}

export interface SessionReview {
  summary: string;
  strengths: string[];
  improvements: string[];
  focusTomorrow: string;
  generatedAt: string;
  source: 'ai' | 'local';
}

export interface TradingSession {
  id: string;
  accountId: string;
  strategyId: string | null;
  date: string;
  startedAt: string;
  endedAt: string | null;
  status: 'active' | 'ended';
  review: SessionReview | null;
}

export type DisciplineEventType =
  | 'RULE_FOLLOWED'
  | 'RULE_OVERRIDDEN'
  | 'STOP_WIDENED'
  | 'DAILY_LIMIT_HIT'
  | 'TRADE_LIMIT_HIT'
  | 'COOLDOWN_BROKEN'
  | 'STRATEGY_VIOLATION'
  | 'JOURNAL_COMPLETED';

export type DisciplineCategory =
  | 'risk'
  | 'entry'
  | 'trade_limit'
  | 'stop'
  | 'cooldown'
  | 'journal'
  | 'strategy';

export interface DisciplineEvent {
  id: string;
  type: DisciplineEventType;
  category: DisciplineCategory;
  accountId: string | null;
  tradeId: string | null;
  sessionId: string | null;
  detail: string;
  at: string;
}

export type SetupGrade = 'A_PLUS' | 'VALID' | 'CAUTION' | 'RULE_VIOLATION' | 'NO_TRADE';

export type GuardStatus = 'SAFE' | 'CAUTION' | 'STOP';

export interface NotificationPrefs {
  preSession: boolean;
  lossLimit: boolean;
  tradeLimit: boolean;
  cooldown: boolean;
  journal: boolean;
}

export type TradingStyle = 'scalp' | 'intraday' | 'swing';
export type PreferredSession = 'ny_open' | 'morning' | 'afternoon';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type HoldTime = 'lt5' | '5to30' | '30to120' | 'hours';
export type RiskPreference = 'conservative' | 'balanced' | 'aggressive';
export type ConnectionMethod = 'manual' | 'screenshot' | 'connected';

/** Which experience the app shows. Switchable any time — data is shared and never lost. */
export type ExperienceMode = 'beginner' | 'experienced';

export interface TradingProfile {
  path: 'have_strategy' | 'build' | null;
  /** Absent for older profiles = experienced. */
  mode?: ExperienceMode;
  style: TradingStyle;
  session: PreferredSession;
  experience: ExperienceLevel;
  holdTime: HoldTime;
  riskPreference: RiskPreference;
  connection: ConnectionMethod;
}

export interface UserPreferences {
  displayName: string;
  email: string;
  timezone: string;
  defaultInstrument: InstrumentSymbol;
  markets: InstrumentSymbol[];
  /** User-defined contracts (tick size / value) beyond the built-in catalog. */
  customInstruments: InstrumentSpec[];
  tradingType: TradingType;
  propFirm: string;
  notifications: NotificationPrefs;
  tradingProfile: TradingProfile;
  onboarded: boolean;
  /** Beginner learning path progress (kept when switching experience). */
  learning?: LearningProgress;
}

/** Lesson progress, assessment and plan for the beginner path. */
export interface LearningProgress {
  lessons: Record<string, { status: 'started' | 'completed' | 'skipped'; quizScore?: number | null; updatedAt: string }>;
  lastLessonId: string | null;
  personality: PersonalityResult | null;
  /** The plan the trader built and applied (strategy + rules), if any. */
  plan: { templateId: string; strategyId: string | null; appliedAt: string } | null;
}

export interface PersonalityAnswers {
  hours: 'lt1' | '1to2' | '2to4' | 'gt4';
  session: 'ny_open' | 'ny_morning' | 'ny_afternoon' | 'flexible';
  afterLoss: 'revenge' | 'frustrated' | 'calm';
  openLoss: 'uncomfortable' | 'okay' | 'comfortable';
  frequency: 'frequent' | 'quality' | 'selective';
  hold: '1-5' | '5-20' | '20-60' | '60+';
  /** The trader's own dollar limits. */
  riskPerTrade: number;
  dailyLoss: number;
  experience: 'Beginner' | 'Intermediate' | 'Advanced';
}

export interface PersonalityResult {
  answers: PersonalityAnswers;
  archetype: string;
  summary: string;
  traits: string[];
  cautions: string[];
  suggestedRules: { maxRiskPerTrade: number; dailyStop: number; maxTradesPerDay: number; cooldownMinutes: number; maxConsecutiveLosses: number };
  completedAt: string;
}

// ───────────────────────────── Setup Check ─────────────────────────────

type SC = typeof import('@/lib/engines/setupCheck');

/**
 * A saved Setup Check: the trader's SAVED rules checked against chart / manual
 * evidence and risk limits at one moment. Every value comes from the
 * deterministic engine (`evaluateSetup`) — on the server in cloud mode, on
 * the device in demo / manual-only mode (`evaluatedBy`).
 */
export interface SetupCheck {
  id: string;
  version: 2;
  createdAt: string;
  accountId: string | null;
  strategyId: string;
  strategyName: string;
  /** Saved-strategy version the evidence belongs to. */
  strategyVersion: string;
  instrument: string;
  timeframe: string | null;
  direction: 'long' | 'short' | 'unsure';
  decision: import('@/lib/engines/setupCheck').Decision;
  /** Confirmed required rules / all required rules × 100 (not a win probability). */
  ruleAlignmentScore: number;
  evidenceConfidence: number;
  riskCheck: 'PASS' | 'FAIL' | 'UNVERIFIED';
  propFirmCompliance: 'PASS' | 'FAIL' | 'UNVERIFIED' | 'NOT_APPLICABLE';
  passedRequired: number;
  totalRequired: number;
  evaluatedRules: ReturnType<SC['evaluateSetup']>['evaluatedRules'];
  riskChecks: import('@/lib/engines/setupCheck').Check[];
  propChecks: import('@/lib/engines/setupCheck').Check[];
  blockers: import('@/lib/engines/setupCheck').Check[];
  dollarRisk: number | null;
  reward: number | null;
  rr: number | null;
  analysisMode: import('@/lib/engines/setupCheck').AnalysisMode;
  evaluatedBy: 'server' | 'device';
  analysisId: number | null;
  analysisKey: string | null;
  inputs: { entry: number | null; stop: number | null; target: number | null; target2?: number | null; quantity: number | null; costs: number | null; slippage: number | null; reserve: number | null };
  /** ICC strategies: the ICC SETUP card at save time. */
  icc?: IccSummary | null;
  /** Unified decision at save time (status, match score, conditions, prop rows, risk). */
  setupDecision?: SetupDecision | null;
  /** 'trade_plan' = QUALIFIED and saved as a pending journal trade; 'setup_review' = analysis only (WAIT / STAND DOWN / BLOCKED), never an executed trade. */
  kind?: 'trade_plan' | 'setup_review';
  /** e.g. "ICC — Awaiting confirmation". */
  setupType?: string | null;
  notes: string;
  /** Local image uri (this device) and private storage path (cloud, when uploaded). */
  screenshotUri: string | null;
  screenshotPath: string | null;
  /** Trade taken from this check (linked when the trade is opened or journaled). */
  tradeId: string | null;
  saved: boolean;
}
