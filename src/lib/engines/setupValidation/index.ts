import type { SetupCheck, Strategy, Trade } from '@/types/domain';

import { strategyCriteria, sanitizeRuleText } from './criteria';
import { cleanLanguage, outcomeOf, visualResults } from './decision';
import { computedCriteria, propCriteria, riskCriteria, riskNumbers } from './risk';
import type { CriterionResult, RiskContext, SetupCheckUserInput, SetupCriterion, VisionOutput } from './types';

export * from './types';
export { strategyCriteria, hasCheckableRules, sanitizeRuleText } from './criteria';
export { parseVisionOutput, decide, setupScore, gradeFor, outcomeOf, visualResults, cleanLanguage, BANNED_LANGUAGE, MIN_IMAGE_QUALITY, MIN_PASS_CONFIDENCE } from './decision';
export { accountRiskContext, computedCriteria, propCriteria, riskCriteria, riskNumbers } from './risk';

export const SETUP_CHECK_VERSION = 1;

/** What the vision model receives: the visual rules + context, all as DATA (sanitized). */
export interface VisionRequest {
  strategyName: string;
  strategyTimeframe: string;
  instrument: string;
  timeframe: string | null;
  direction: 'long' | 'short' | 'unsure';
  prices: { entry: number | null; stop: number | null; target: number | null };
  notes: string;
  criteria: { ruleId: string; ruleName: string; description: string; required: boolean; inverted: boolean }[];
}

export function visionRequestOf(strategy: Strategy, input: SetupCheckUserInput, criteria: SetupCriterion[]): VisionRequest {
  return {
    strategyName: sanitizeRuleText(strategy.name).slice(0, 80),
    strategyTimeframe: sanitizeRuleText(strategy.timeframe).slice(0, 60),
    instrument: sanitizeRuleText(input.instrument).slice(0, 12),
    timeframe: input.timeframe ? sanitizeRuleText(input.timeframe).slice(0, 20) : null,
    direction: input.direction,
    prices: { entry: input.entry, stop: input.stop, target: input.target },
    notes: sanitizeRuleText(input.notes).slice(0, 240),
    criteria: criteria
      .filter((c) => c.kind === 'visual')
      .map((c) => ({ ruleId: c.id, ruleName: c.name, description: c.inverted ? `MUST NOT be present: ${c.description}` : c.description, required: c.required, inverted: !!c.inverted })),
  };
}

export interface EvaluateSetupArgs {
  id: string;
  strategy: Strategy;
  input: SetupCheckUserInput;
  /** Validated vision output, or null when the analysis is unavailable. */
  vision: VisionOutput | null;
  risk: RiskContext;
  accountId: string | null;
  now: Date;
  provider: 'ai' | 'mock';
  model: string | null;
  screenshotUri: string | null;
}

/** Combine vision evidence with app-computed checks and decide — deterministically. */
export function evaluateSetup(a: EvaluateSetupArgs): SetupCheck {
  const criteria = strategyCriteria(a.strategy, { direction: a.input.direction });
  const budget = a.risk.maxRiskPerTrade != null && a.risk.guard ? Math.min(a.risk.maxRiskPerTrade, a.risk.guard.riskRemaining) : (a.risk.maxRiskPerTrade ?? a.risk.guard?.riskRemaining ?? null);
  const numbers = riskNumbers(a.input, a.vision, budget);
  const results: CriterionResult[] = [
    ...visualResults(criteria, a.vision, { mock: a.provider === 'mock' }),
    ...computedCriteria(a.strategy, a.input, numbers, a.now, a.risk),
    ...riskCriteria(numbers, a.risk),
    ...propCriteria(numbers, a.risk),
  ];
  const outcome = outcomeOf(results, a.vision);
  return {
    id: a.id,
    version: SETUP_CHECK_VERSION,
    createdAt: a.now.toISOString(),
    accountId: a.accountId,
    strategyId: a.strategy.id,
    strategyName: a.strategy.name,
    instrument: a.input.instrument,
    timeframe: a.input.timeframe,
    direction: a.input.direction,
    decision: outcome.decision,
    score: outcome.score,
    grade: outcome.grade,
    gradeLabel: outcome.gradeLabel,
    why: outcome.why,
    next: outcome.next,
    requiredTotal: outcome.requiredTotal,
    requiredPassed: outcome.requiredPassed,
    criteria: results,
    chart: a.vision?.chart ?? { instrument: null, timeframe: null, directionObserved: null, marketCondition: null },
    risk: numbers,
    imageQuality: a.vision?.imageQuality ?? { score: 0, issues: ['No chart analysis available.'] },
    evidenceConfidence: outcome.evidenceConfidence,
    summary: cleanLanguage(a.vision?.summary ?? ''),
    notes: a.input.notes,
    screenshotUri: a.screenshotUri,
    screenshotPath: null,
    provider: a.provider,
    model: a.model,
    tradeId: null,
    saved: false,
  };
}

// ───────────────────────────── Future analytics ─────────────────────────────

export interface SetupCheckBucket {
  decision: SetupCheck['decision'];
  checks: number;
  taken: number;
  closed: number;
  wins: number;
  netPnl: number;
}

/**
 * QUALIFIED setups taken vs WAIT / STAND DOWN setups taken anyway, with their
 * actual results — process analytics, not a forecast.
 */
export function setupCheckOutcomes(checks: SetupCheck[], trades: Trade[]): SetupCheckBucket[] {
  const byId = new Map(trades.map((t) => [t.id, t]));
  return (['QUALIFIED', 'WAIT', 'STAND_DOWN'] as const).map((decision) => {
    const list = checks.filter((c) => c.decision === decision);
    const linked = list.map((c) => (c.tradeId ? byId.get(c.tradeId) : undefined)).filter((t): t is Trade => !!t);
    const closed = linked.filter((t) => t.status === 'closed' && t.pnl != null);
    return { decision, checks: list.length, taken: linked.length, closed: closed.length, wins: closed.filter((t) => (t.pnl ?? 0) > 0).length, netPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0) };
  });
}
