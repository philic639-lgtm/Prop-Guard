import { z } from 'zod';

/**
 * AI Setup Validation — "Does what is visible in this screenshot satisfy MY
 * saved rules right now?"
 *
 * Layers (kept separate on purpose):
 *   criteria   — the trader's saved strategy turned into checkable rules
 *   vision     — the model reports evidence + PASS/FAIL/UNVERIFIED per VISUAL rule
 *   risk/prop  — deterministic checks from prices, Daily Guard and account rules
 *   decision   — deterministic: the model never chooses the final status
 */

export type CriterionStatus = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'NOT_APPLICABLE';
export const CRITERION_STATUSES: CriterionStatus[] = ['PASS', 'FAIL', 'UNVERIFIED', 'NOT_APPLICABLE'];

export type SetupDecision = 'QUALIFIED' | 'WAIT' | 'STAND_DOWN';

/**
 * Who evaluates a criterion:
 * - visual   — the vision model, from the screenshot (+ user notes)
 * - computed — app code (time window, instrument, R:R, stop present…)
 * - risk     — app code: the trader's personal risk rules / Daily Guard
 * - prop     — app code: account / prop-firm limits (verified status tracked)
 */
export type CriterionKind = 'visual' | 'computed' | 'risk' | 'prop';

/** Where a criterion comes from in the trader's saved strategy / settings. */
export type CriterionOrigin = 'checklist' | 'entry_trigger' | 'confirmation' | 'retest' | 'invalidation' | 'bias' | 'plan_rule' | 'strategy_field' | 'risk_settings' | 'daily_guard' | 'account_rule';

export interface SetupCriterion {
  id: string;
  name: string;
  /** The trader's own rule text (what must be true). */
  description: string;
  required: boolean;
  weight: number;
  kind: CriterionKind;
  origin: CriterionOrigin;
  /** Invalidation / no-trade rules: PASS means the condition is NOT present. */
  inverted?: boolean;
  /** Prop rules: whether the value comes from a verified firm rule. */
  propVerification?: PropVerification;
}

export type PropVerification = 'verified' | 'account_setting' | 'unverified';

export interface CriterionResult {
  ruleId: string;
  ruleName: string;
  status: CriterionStatus;
  evidence: string;
  /** 0–1. */
  confidence: number;
  required: boolean;
  weight: number;
  kind: CriterionKind;
  origin: CriterionOrigin;
  propVerification?: PropVerification;
}

// ───────────────────────────── AI output contract ─────────────────────────────

const nullableString = z.string().max(200).nullable();
const price = z.number().finite().positive().nullable();

/**
 * What the vision model may return. There is deliberately NO final status /
 * decision / grade field — the app computes those.
 */
export const VisionOutputSchema = z.object({
  chart: z.object({
    instrument: nullableString,
    timeframe: nullableString,
    directionObserved: z.enum(['up', 'down', 'sideways']).nullable(),
    marketCondition: nullableString,
  }),
  criteria: z
    .array(
      z.object({
        ruleId: z.string().min(1).max(120),
        ruleName: z.string().max(200),
        status: z.enum(['PASS', 'FAIL', 'UNVERIFIED', 'NOT_APPLICABLE']),
        evidence: z.string().max(600),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(60),
  riskEvidence: z.object({ entry: price, stop: price, target: price, pricesConfidence: z.number().min(0).max(1) }),
  imageQuality: z.object({ score: z.number().min(0).max(100), issues: z.array(z.string().max(200)).max(12) }),
  summary: z.string().max(800),
});
export type VisionOutput = z.infer<typeof VisionOutputSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

export type ConsideredDirection = 'long' | 'short' | 'unsure';

export interface SetupCheckUserInput {
  strategyId: string;
  instrument: string;
  timeframe: string | null;
  direction: ConsideredDirection;
  entry: number | null;
  stop: number | null;
  target: number | null;
  contracts: number | null;
  notes: string;
}

/** Risk context the app already knows (Daily Guard, personal rules, account). */
export interface RiskContext {
  maxRiskPerTrade: number | null;
  requireStop: boolean;
  requireTarget: boolean;
  guard: {
    status: 'GO' | 'CAUTION' | 'STOP' | string;
    headline: string;
    reasons: string[];
    riskRemaining: number;
    tradesRemaining: number;
    cooldownActive: boolean;
    drawdownBuffer: number | null;
  } | null;
  account: {
    name: string;
    firm: string;
    kind: 'prop' | 'personal';
    maxContracts: { value: number | null; verification: PropVerification };
    dailyLossLimit: { value: number | null; verification: PropVerification };
    maxDrawdown: { value: number | null; verification: PropVerification };
    /** Firm rules on file that could not be verified (NEEDS_REVIEW) — shown, never enforced. */
    unverifiedFirmRules: string[];
  } | null;
}

export interface RiskNumbers {
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Where the prices came from. */
  pricesFrom: 'user' | 'chart' | 'mixed' | 'none';
  pointsRisk: number | null;
  pointsReward: number | null;
  rr: number | null;
  contracts: number | null;
  riskDollars: number | null;
  rewardDollars: number | null;
  /** Largest size within the risk budget (when no size was entered). */
  maxContractsForBudget: number | null;
}

export type Grade = 'A' | 'B' | 'C' | 'WEAK';

export interface SetupCheckOutcome {
  decision: SetupDecision;
  /** 0–100, or null when nothing could be verified. */
  score: number | null;
  grade: Grade | null;
  gradeLabel: string;
  why: string;
  next: string[];
  requiredTotal: number;
  requiredPassed: number;
  /** Required criteria that failed (STAND DOWN reasons). */
  failedRequired: CriterionResult[];
  /** Required criteria still missing evidence (WAIT reasons). */
  unverifiedRequired: CriterionResult[];
  /** Overall evidence confidence 0–100. */
  evidenceConfidence: number;
}
