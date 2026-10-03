/**
 * Core domain model for Prop Guard.
 *
 * These types are storage-agnostic: the local store, demo data and the
 * Supabase repositories all map to and from these shapes.
 */

export type InstrumentSymbol = 'ES' | 'MES' | 'NQ' | 'MNQ';
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
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistAnswer {
  itemId: string;
  label: string;
  value: boolean;
}

export type TradeStatus = 'open' | 'closed' | 'cancelled';
export type TradeSource = 'manual' | 'screenshot';
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

export interface UserPreferences {
  displayName: string;
  email: string;
  timezone: string;
  defaultInstrument: InstrumentSymbol;
  markets: (InstrumentSymbol | 'OTHER')[];
  tradingType: TradingType;
  propFirm: string;
  notifications: NotificationPrefs;
  onboarded: boolean;
}
