/**
 * Historical Trading Trainer types.
 *
 * Three data layers stay separate:
 *  1. STRATEGY KNOWLEDGE — Strategy Library templates (referenced by `strategyId` only).
 *  2. MARKET HISTORY     — PracticeScenario (candles + what actually happened).
 *  3. USER PERFORMANCE   — PracticeAttempt / PracticeLesson (the trader's own activity).
 */

export type PracticeDecision = 'long' | 'short' | 'wait';
export type PracticeSession = 'morning' | 'afternoon';
export type PracticeDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface PracticeCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Where a scenario's candles came from. Sample data is never presented as real history. */
export interface ScenarioSource {
  kind: 'educational_sample' | 'historical';
  /** True only for candles from a verified market-data provider. */
  verified: boolean;
  provider?: string;
  note: string;
}

export interface PracticeLevel {
  label: string;
  price: number;
  kind: 'orb_high' | 'orb_low' | 'resistance' | 'support' | 'pdh' | 'pdl' | 'swing_high' | 'swing_low' | 'prior_close';
}

export interface PracticeScenario {
  id: string;
  instrument: string;
  /** Strategy Library template id (knowledge lives there, not here). */
  strategyId: string;
  strategyName: string;
  date: string;
  session: PracticeSession;
  difficulty: PracticeDifficulty;
  /** Orientation of the pattern (used for long/short filters; the ideal decision may still be WAIT). */
  direction: 'long' | 'short';
  quality: 'great' | 'standard' | 'trap';
  source: ScenarioSource;

  marketContext: {
    higherTimeframeBias: 'bullish' | 'bearish' | 'neutral';
    trend: 'uptrend' | 'downtrend' | 'range';
    volatility: 'low' | 'normal' | 'high';
    openingRangeSize?: number;
    notes?: string;
  };

  candles: PracticeCandle[];
  /** Last candle shown before the decision. Candles after it are hidden until replay. */
  decisionIndex: number;
  /** Structural levels the strategy uses — shown before the decision (never the answer). */
  levels: PracticeLevel[];
  /** Optional VWAP series aligned with candles. */
  vwap?: number[];
  /** Opening range box (candle index range), if the strategy uses one. */
  openingRange?: { from: number; to: number; high: number; low: number };

  idealDecision: PracticeDecision;
  idealTrade?: {
    entry: number;
    stop: number;
    target: number;
    riskReward: number;
  };
  /** Acceptable entry band for scoring entry quality / timing. */
  idealEntryZone?: [number, number];

  setupCharacteristics: {
    retestNumber?: number;
    trendAligned?: boolean;
    firstRetest?: boolean;
    breakoutStrength?: 'weak' | 'normal' | 'strong';
    entryQuality?: 'early' | 'ideal' | 'late';
  };

  explanation: string[];
  lesson: string;
  commonMistake: string;
  badges: string[];

  outcome: {
    result: 'win' | 'loss' | 'no-trade';
    maxFavorableExcursion?: number;
    maxAdverseExcursion?: number;
    targetReached?: boolean;
    stopReached?: boolean;
    summary: string;
  };
}

export interface PracticeTradeInput {
  decision: PracticeDecision;
  entry?: number;
  stop?: number;
  target?: number;
}

export interface PracticeScore {
  total: number;
  components: {
    strategyMatch: number;
    trendAlignment: number;
    entryQuality: number;
    riskReward: number;
    timing: number;
  };
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  verdict: 'Excellent Setup' | 'Valid Setup' | 'Marginal Setup' | 'Low Quality' | 'Avoid';
  /** Did the decision match the ideal decision? (Accuracy is about identification, not P&L.) */
  correct: boolean;
  strengths: string[];
  mistakes: string[];
  lesson: string;
}

export type ReplayStatus = 'target' | 'stop' | 'expired' | 'not_filled' | 'no_trade';

export interface ReplayOutcome {
  status: ReplayStatus;
  fillIndex: number | null;
  exitIndex: number | null;
  exitPrice: number | null;
  pnlPoints: number | null;
  mfe: number | null;
  mae: number | null;
}

export type PracticeResult = 'win' | 'loss' | 'expired' | 'not-filled' | 'correct-wait' | 'incorrect-wait';

export interface PracticeAttempt {
  id: string;
  userId?: string;
  scenarioId: string;
  instrument: string;
  strategyId: string;
  strategyName: string;
  timestamp: string;
  mode: 'standard' | 'smart' | 'great';
  session: PracticeSession;
  /** Pattern orientation of the scenario. */
  direction: 'long' | 'short';
  decision: PracticeDecision;
  idealDecision: PracticeDecision;
  correct: boolean;
  entry?: number;
  stop?: number;
  target?: number;
  riskReward?: number;
  score: number;
  grade: PracticeScore['grade'];
  result: PracticeResult;
  mistakes: string[];
  setupCharacteristics: {
    retestNumber?: number;
    trendAligned?: boolean;
    entryQuality?: string;
  };
}

/** A lesson the trader chose to keep — shown in Journal → Practice lessons, never mixed with real trades. */
export interface PracticeLesson {
  id: string;
  attemptId: string;
  scenarioId: string;
  strategyId: string;
  strategyName: string;
  instrument: string;
  score: number;
  grade: PracticeScore['grade'];
  lesson: string;
  createdAt: string;
}

/** Normalized description of a setup for future similarity search. */
export interface SetupFingerprint {
  instrument: string;
  strategyId: string;
  direction: 'long' | 'short';
  trend: string;
  higherTimeframeBias: string;
  volatility: string;
  retestNumber?: number;
  openingRangeSize?: number;
  breakoutStrength?: string;
  sessionTime?: string;
  riskReward?: number;
}
