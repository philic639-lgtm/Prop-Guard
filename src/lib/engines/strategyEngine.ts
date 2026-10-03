import type {
  Bias,
  ChecklistItem,
  Direction,
  SetupGrade,
  Strategy,
  TradingRules,
} from '@/types/domain';
import { easternMinutes, formatClock, parseClock } from '@/utils/dates';

import type { DailyGuard } from './dailyGuardEngine';
import { cleanNumber } from './instrumentEngine';
import type { TradeRiskResult } from './riskEngine';

export type CheckSeverity = 'checklist' | 'rule' | 'context';

export interface SetupCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: CheckSeverity;
  detail?: string;
}

export interface SetupEvaluation {
  grade: SetupGrade;
  matchPct: number;
  checks: SetupCheck[];
  cautions: string[];
  violations: string[];
  /** Short machine-friendly ids of rules that were followed / violated. */
  rulesFollowed: string[];
  rulesViolated: string[];
}

export interface SetupEvaluationInput {
  strategy: Strategy;
  direction: Direction;
  bias: Bias | null;
  answers: Record<string, boolean | null | undefined>;
  risk: TradeRiskResult;
  contracts: number;
  rules: TradingRules;
  guard: DailyGuard;
  /** Stop distances (points) from recent trades on this strategy. */
  recentStopPoints: number[];
  strategyTradesToday: number;
  now?: Date;
}

export const GRADE_LABEL: Record<SetupGrade, string> = {
  A_PLUS: 'A+ Setup',
  VALID: 'Valid Setup',
  CAUTION: 'Caution',
  RULE_VIOLATION: 'Rule Violation',
  NO_TRADE: 'No Trade',
};

const WEIGHT = { checklist: 2, rule: 2, context: 1 } as const;

function biasMatches(direction: Direction, bias: Bias | null): boolean {
  if (bias === 'bullish') return direction === 'long';
  if (bias === 'bearish') return direction === 'short';
  return false;
}

export function inEntryWindow(strategy: Strategy, now: Date): boolean | null {
  const start = parseClock(strategy.entryWindowStart);
  const end = parseClock(strategy.entryWindowEnd);
  if (start === null || end === null) return null;
  const mins = easternMinutes(now);
  return start <= end ? mins >= start && mins <= end : mins >= start || mins <= end;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Deterministic evaluation of whether a proposed trade complies with the
 * trader's OWN strategy and rules. It never predicts market direction.
 * AI narrative (if any) is layered on top; the grade always comes from here
 * so a model can never talk a trader into breaking their rules.
 */
export function evaluateSetup(input: SetupEvaluationInput): SetupEvaluation {
  const { strategy, direction, bias, answers, risk, contracts, rules, guard, recentStopPoints, strategyTradesToday } =
    input;
  const now = input.now ?? new Date();
  const checks: SetupCheck[] = [];
  const cautions: string[] = [];
  const violations: string[] = [];

  // 1. Strategy checklist
  for (const item of strategy.checklist.filter((i: ChecklistItem) => i.kind === 'yesno')) {
    const value = answers[item.id];
    checks.push({
      id: `check_${item.id}`,
      label: item.label,
      passed: value === true,
      severity: 'checklist',
      detail: value == null ? 'Not answered' : undefined,
    });
  }

  // 2. Higher-timeframe bias alignment
  if (strategy.requiresBiasAlignment) {
    const aligned = biasMatches(direction, bias);
    checks.push({
      id: 'bias_aligned',
      label: aligned ? `${strategy.biasRequirement || 'Bias'} aligned` : 'Bias not aligned with direction',
      passed: aligned,
      severity: 'checklist',
      detail: bias === 'neutral' ? 'Bias is neutral — strategy requires a directional bias.' : undefined,
    });
  }

  // 3. Risk & rule checks
  if (!risk.valid) {
    violations.push(...risk.errors);
  }

  const riskDollars = risk.riskDollars ?? 0;
  const hasTarget = risk.pointsReward != null;

  if (rules.requireTarget) {
    checks.push({ id: 'target_set', label: 'Target defined', passed: hasTarget, severity: 'rule' });
    if (!hasTarget) violations.push('Your rules require a target before entry.');
  }

  if (risk.valid) {
    const withinTradeRisk = riskDollars <= rules.maxRiskPerTrade;
    checks.push({
      id: 'risk_per_trade',
      label: 'Risk within per-trade limit',
      passed: withinTradeRisk,
      severity: 'rule',
      detail: `$${riskDollars.toFixed(0)} vs $${rules.maxRiskPerTrade.toFixed(0)} max`,
    });
    if (!withinTradeRisk) {
      violations.push(
        `Risk of $${riskDollars.toFixed(0)} exceeds your $${rules.maxRiskPerTrade.toFixed(0)} per-trade limit.`,
      );
    }

    const withinDaily = guard.dailyLimit <= 0 || riskDollars <= guard.riskRemaining;
    checks.push({ id: 'risk_daily', label: 'Risk below daily limit', passed: withinDaily, severity: 'rule' });
    if (!withinDaily) {
      violations.push(`A stop-out would exceed your remaining daily risk of $${guard.riskRemaining.toFixed(0)}.`);
    }

    if (risk.rr != null) {
      const rrOk = risk.rr + 1e-9 >= strategy.minRR;
      checks.push({
        id: 'min_rr',
        label: `Minimum R:R 1:${strategy.minRR}`,
        passed: rrOk,
        severity: 'rule',
        detail: `Planned 1:${risk.rr.toFixed(2)}`,
      });
      if (!rrOk) violations.push(`R:R of 1:${risk.rr.toFixed(2)} is below your strategy minimum of 1:${strategy.minRR}.`);
    }
  }

  if (guard.maxContracts != null && guard.maxContracts > 0) {
    const ok = contracts <= guard.maxContracts;
    checks.push({ id: 'max_contracts', label: 'Within max contracts', passed: ok, severity: 'rule' });
    if (!ok) violations.push(`${contracts} contracts exceeds your account maximum of ${guard.maxContracts}.`);
  }

  if (guard.cooldown.active) {
    checks.push({ id: 'cooldown', label: 'Cooldown complete', passed: false, severity: 'rule' });
    violations.push('You are still in a post-loss cooldown.');
  }

  if (strategy.maxTrades > 0) {
    const ok = strategyTradesToday < strategy.maxTrades;
    checks.push({ id: 'strategy_max_trades', label: 'Strategy trade limit', passed: ok, severity: 'rule' });
    if (!ok) violations.push(`This strategy allows ${strategy.maxTrades} trade${strategy.maxTrades > 1 ? 's' : ''} per day.`);
  }

  // 4. Context — soft checks that produce cautions, not violations.
  const window = inEntryWindow(strategy, now);
  if (window !== null) {
    checks.push({
      id: 'entry_window',
      label: 'Inside entry window',
      passed: window,
      severity: 'context',
      detail: `${formatClock(strategy.entryWindowStart)} – ${formatClock(strategy.entryWindowEnd)} ET`,
    });
    if (!window) cautions.push('You are outside your strategy entry window.');
  }

  if (risk.valid && risk.pointsRisk != null) {
    const stop = risk.pointsRisk;
    if (strategy.typicalStopMax != null && stop > strategy.typicalStopMax) {
      cautions.push(`Stop of ${stop} pts is wider than your typical maximum of ${strategy.typicalStopMax} pts.`);
    } else if (strategy.typicalStopMin != null && stop < strategy.typicalStopMin) {
      cautions.push(`Stop of ${stop} pts is tighter than your typical minimum of ${strategy.typicalStopMin} pts.`);
    }
    const avg = average(recentStopPoints);
    if (avg != null && stop - avg >= 1) {
      cautions.push(`Your stop is ${cleanNumber(stop - avg, 2)} points wider than your strategy average.`);
    }
  }

  if (guard.consecutiveLosses > 0 && !guard.cooldown.active) {
    cautions.push(`You are coming off ${guard.consecutiveLosses} loss${guard.consecutiveLosses > 1 ? 'es' : ''}. Only take A-quality setups.`);
  }

  // Score
  let total = 0;
  let earned = 0;
  for (const c of checks) {
    total += WEIGHT[c.severity];
    if (c.passed) earned += WEIGHT[c.severity];
  }
  const matchPct = total === 0 ? 0 : Math.round((earned / total) * 100);

  const checklistFailed = checks.some((c) => c.severity === 'checklist' && !c.passed);

  let grade: SetupGrade;
  if (guard.status === 'STOP' || !risk.valid) {
    grade = 'NO_TRADE';
    if (guard.status === 'STOP') violations.unshift(...guard.reasons);
  } else if (violations.length > 0) {
    grade = 'RULE_VIOLATION';
  } else if (checklistFailed) {
    grade = matchPct >= 60 ? 'CAUTION' : 'NO_TRADE';
  } else if (matchPct >= 95 && cautions.length === 0) {
    grade = 'A_PLUS';
  } else if (matchPct >= 80) {
    grade = 'VALID';
  } else {
    grade = 'CAUTION';
  }

  return {
    grade,
    matchPct,
    checks,
    cautions,
    violations: [...new Set(violations)],
    rulesFollowed: checks.filter((c) => c.passed).map((c) => c.id),
    rulesViolated: checks.filter((c) => !c.passed).map((c) => c.id),
  };
}

/** Validates the shape of a strategy before saving. Returns error messages. */
export function validateStrategy(s: Pick<Strategy, 'name' | 'markets' | 'minRR' | 'maxTrades' | 'typicalStopMin' | 'typicalStopMax' | 'entryWindowStart' | 'entryWindowEnd' | 'checklist'>): string[] {
  const errors: string[] = [];
  if (!s.name.trim()) errors.push('Strategy name is required.');
  if (s.markets.length === 0) errors.push('Select at least one market.');
  if (!(s.minRR > 0)) errors.push('Minimum R:R must be greater than 0.');
  if (!Number.isInteger(s.maxTrades) || s.maxTrades < 1) errors.push('Max trades must be at least 1.');
  if (s.typicalStopMin != null && s.typicalStopMax != null && s.typicalStopMin > s.typicalStopMax) {
    errors.push('Typical stop minimum cannot exceed the maximum.');
  }
  const hasStart = !!s.entryWindowStart;
  const hasEnd = !!s.entryWindowEnd;
  if (hasStart !== hasEnd) errors.push('Entry window needs both a start and end time.');
  if (hasStart && parseClock(s.entryWindowStart) === null) errors.push('Entry window start must be HH:mm.');
  if (hasEnd && parseClock(s.entryWindowEnd) === null) errors.push('Entry window end must be HH:mm.');
  if (s.checklist.length === 0) errors.push('Add at least one checklist item.');
  return errors;
}
