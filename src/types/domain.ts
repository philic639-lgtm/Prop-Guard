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
  createdAt: string;
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
}

export type PendingOrigin = 'analyze' | 'calculator';
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

export interface TradingProfile {
  path: 'have_strategy' | 'build' | null;
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
}
