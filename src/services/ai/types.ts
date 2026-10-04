import { z } from 'zod';

import type { FinderAnswers, TemplateMatch } from '@/lib/engines/strategyLibraryEngine';
import { isInstrumentSymbol } from '@/lib/engines/instrumentEngine';
import type { SetupGrade } from '@/types/domain';

/**
 * Typed AI contracts. Inputs are deliberately MINIMAL: no account names,
 * balances, emails or identifiers are ever sent to a model.
 */

// ---------- Setup analysis ----------
export interface SetupAnalysisInput {
  strategy: {
    name: string;
    entryTrigger: string;
    confirmationRules: string;
    retestRules: string;
    invalidationRules: string;
    minRR: number;
    typicalStop: [number | null, number | null];
  };
  trade: {
    instrument: string;
    direction: 'long' | 'short';
    bias: string | null;
    pointsRisk: number | null;
    pointsReward: number | null;
    rr: number | null;
    contracts: number;
  };
  /** Deterministic engine result — the AI may explain it but cannot change the grade. */
  evaluation: {
    grade: SetupGrade;
    matchPct: number;
    passed: string[];
    failed: string[];
    cautions: string[];
    violations: string[];
  };
  context: { riskRemaining: number; tradesRemaining: number; consecutiveLosses: number };
}

export const SetupAnalysisSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  cautions: z.array(z.string().max(240)).max(6),
  reminders: z.array(z.string().max(240)).max(4),
});
export type SetupAnalysis = z.infer<typeof SetupAnalysisSchema> & { source: AISource };

// ---------- Screenshot extraction ----------
export interface ScreenshotInput {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
  /** Demo Mode: the local provider returns a clearly-labelled sample so flows can be previewed. */
  demo?: boolean;
}

const nullableNum = z.number().finite().positive().nullable();
export const ScreenshotExtractionSchema = z.object({
  instrument: z.string().max(8).nullable().transform((v) => (v && isInstrumentSymbol(v.toUpperCase()) ? v.toUpperCase() : null)),
  direction: z.enum(['long', 'short']).nullable(),
  entry: nullableNum,
  stop: nullableNum,
  target: nullableNum,
  levels: z.array(z.object({ label: z.string().max(40), price: z.number().finite() })).max(12),
  detected: z.object({ orb: z.boolean(), vwap: z.boolean(), supportResistance: z.boolean() }),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.string().max(400),
});
export type ScreenshotExtraction = z.infer<typeof ScreenshotExtractionSchema> & { source: AISource };

// ---------- Session review ----------
export interface SessionReviewInput {
  trades: { direction: string; instrument: string; pnl: number | null; realizedR: number | null; grade: string | null; violations: string[] }[];
  netPnl: number;
  winRate: number | null;
  rulesFollowedPct: number;
  violations: { type: string; detail: string }[];
  cooldownGaps: number[];
  rules: { maxTradesPerDay: number; cooldownMinutes: number; maxRiskPerTrade: number };
}

export const SessionReviewSchema = z.object({
  summary: z.string().min(1).max(600),
  strengths: z.array(z.string().max(200)).max(5),
  improvements: z.array(z.string().max(240)).max(5),
  focusTomorrow: z.string().min(1).max(200),
});

// ---------- Strategy finder ----------
/**
 * The finder ranks Prop Guard's CURATED library deterministically
 * (strategyLibraryEngine.matchTemplates). AI may only rephrase the reasons
 * for templates already ranked — it cannot add strategies, change scores,
 * or make performance claims.
 */
export type StrategyFinderAnswers = FinderAnswers;
export type StrategyRecommendation = TemplateMatch;

export const StrategyReasonsSchema = z.object({
  explanations: z
    .array(
      z.object({
        templateId: z.string(),
        reasons: z.array(z.string().max(200)).min(1).max(6),
      }),
    )
    .max(5),
});

// ---------- Daily coach ----------
export interface DailyCoachInput {
  guardStatus: 'SAFE' | 'CAUTION' | 'STOP';
  tradesTaken: number;
  maxTrades: number;
  riskRemaining: number;
  consecutiveLosses: number;
  cooldownActive: boolean;
  lastSetupMatchPct: number | null;
  disciplineScore: number;
  strategyName: string | null;
}

export const DailyCoachSchema = z.object({
  message: z.string().min(1).max(400),
  bestAction: z.string().min(1).max(160),
});
export type DailyCoach = z.infer<typeof DailyCoachSchema> & { source: AISource };

// ---------- Strategy description → rules ----------
export const ParsedStrategySchema = z.object({
  name: z.string().min(1).max(60),
  instrument: z.string().max(8).nullable().transform((v) => (v && isInstrumentSymbol(v.toUpperCase()) ? v.toUpperCase() : null)),
  entryWindowStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  entryWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  biasRequirement: z.string().max(60),
  requiresBiasAlignment: z.boolean(),
  stopMaxPoints: z.number().positive().nullable(),
  minRR: z.number().positive().nullable(),
  maxTrades: z.number().int().positive().max(20).nullable(),
  conditions: z.array(z.string().min(1).max(120)).max(12),
});

// ---------- Account screenshot import ----------
export const AccountExtractionSchema = z.object({
  balance: z.number().nonnegative().nullable(),
  dailyPnl: z.number().nullable(),
  totalPnl: z.number().nullable(),
  drawdownRemaining: z.number().nonnegative().nullable(),
  accountType: z.string().max(40).nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  notes: z.string().max(300),
});
export type AccountExtraction = z.infer<typeof AccountExtractionSchema> & { source: AISource };

// ---------- Practice feedback ----------
export interface PracticeInput {
  strategyName: string;
  conditions: { label: string; met: boolean }[];
}
export const PracticeFeedbackSchema = z.object({ feedback: z.string().min(1).max(400) });

export type AISource = 'ai' | 'local';

// ---------- Strategy Intelligence (free-text strategy analysis) ----------
const SECTION = z.enum(['bias', 'context', 'setup', 'entry', 'confirmation', 'stop', 'target', 'management', 'invalidation', 'noTrade', 'risk', 'maxTrades', 'filter', 'volatility', 'volume']);
const HHMM = z.string().regex(/^\d{2}:\d{2}$/).nullable().catch(null);

/** Model output for `strategy_analyze`. Validated, then merged with the on-device engine (which scores it). */
export const StrategyAnalysisAISchema = z.object({
  name: z.string().min(1).max(60),
  classification: z.string().max(120).catch(''),
  styles: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(60), evidence: z.array(z.string().max(120)).max(6).catch([]) })).max(8).catch([]),
  direction: z.enum(['long', 'short', 'both']).nullable().catch(null),
  instruments: z.array(z.string().max(8)).max(6).catch([]),
  session: z.string().max(40).catch(''),
  tradingWindow: z.object({ start: HHMM, end: HHMM }).catch({ start: null, end: null }),
  timeframes: z.array(z.string().max(12)).max(6).catch([]),
  maxTrades: z.number().int().positive().max(50).nullable().catch(null),
  stopPoints: z.number().positive().max(10000).nullable().catch(null),
  minRR: z.number().positive().max(20).nullable().catch(null),
  rules: z.array(z.object({ section: SECTION, text: z.string().min(1).max(220), provenance: z.enum(['trader', 'inferred']), quote: z.string().max(300).nullable().optional() })).max(40),
  suggestions: z
    .array(
      z.object({
        section: SECTION,
        kind: z.enum(['objectify', 'missing', 'protection']),
        title: z.string().min(1).max(100),
        issue: z.string().max(300),
        original: z.string().max(300).nullable().optional(),
        suggestedRule: z.string().min(1).max(300),
        rationale: z.string().max(300).catch(''),
        // E (historically validated) can only come from Prop Guard's own verified data, never from a model.
        confidence: z.enum(['A', 'B', 'C', 'D', 'E']).transform((c) => (c === 'E' ? 'D' : c)).catch('D'),
      }),
    )
    .max(16)
    .catch([]),
  questions: z
    .array(
      z.object({
        variable: z.enum(['instrument', 'entryTrigger', 'openingRangeMinutes', 'timeframe', 'direction']),
        question: z.string().min(1).max(200),
        why: z.string().max(200).catch(''),
        options: z.array(z.string().max(20)).max(8).optional(),
      }),
    )
    .max(3)
    .catch([]),
  behavioralRisks: z
    .array(
      z.object({
        behavior: z.enum(['chasing', 'revenge_trading', 'entering_too_early', 'over_confirmation', 'fomo', 'oversized_risk', 'moving_stops', 'holding_losers', 'cutting_winners_early', 'overtrading', 'trading_chop', 'predicting_not_reacting']),
        title: z.string().min(1).max(100),
        explanation: z.string().max(400),
        mitigation: z.string().max(240).catch(''),
        severity: z.enum(['low', 'medium', 'high']).catch('medium'),
      }),
    )
    .max(10)
    .catch([]),
});
export type StrategyAnalysisAI = z.infer<typeof StrategyAnalysisAISchema>;
