// SHARED, dependency-free (synced to supabase/functions/_shared/setupCheck).
// One risk summary for Setup Check, built from the engine's own Input (point
// value / tick size from the instrument catalog, never hard-coded) and the
// engine's computed dollar risk / reward. The app's riskEngine uses the same
// catalog; a test keeps the two in agreement for every instrument class.
import type { Input, SetupEvaluation } from './engine';

/**
 * Documented NON-BINDING daily cap: used only when the trader explicitly
 * confirms their account has no daily loss limit. Finite so the engine's
 * arithmetic stays well-defined; far above any real account.
 */
export const NONBINDING_DAILY_LIMIT = 1_000_000_000;

export interface RiskSummary {
  /** |entry − stop| in price points. */
  pointRisk: number | null;
  /** Dollars per contract to the stop (excl. costs). */
  riskPerContract: number | null;
  /** Fees + slippage for the whole position. */
  costs: number | null;
  contracts: number | null;
  /** Engine: whole position incl. costs. */
  dollarRisk: number | null;
  reward: number | null;
  rr: number | null;
  minimumRR: number | null;
  /** The trader's max risk per trade. */
  maxRisk: number | null;
  /** Tightest dollar limit that applies: plan max risk, daily loss remaining or drawdown buffer (after reserve). */
  riskLimit: number | null;
  limitSource: 'plan' | 'daily_loss' | 'drawdown' | null;
  /** Contract cap from the plan or the prop account (micro-normalized). */
  contractCap: number | null;
  /** Largest whole size that fits both the dollar limit and the contract cap. */
  maxAllowedContracts: number | null;
  riskCapExceeded: boolean;
  contractsExceeded: boolean;
  rrBelowMinimum: boolean;
  /** Even one contract to this stop is over the dollar limit. */
  stopTooWide: boolean;
}

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function riskSummary(input: Input, evaluation: SetupEvaluation): RiskSummary {
  const t = input.trade;
  const p = input.prop;
  const pointRisk = fin(t.entry) && fin(t.stop) ? Math.abs(t.entry - t.stop) : null;
  const riskPerContract = pointRisk != null && fin(t.pointValue) ? pointRisk * t.pointValue : null;
  const costs = fin(t.costs) && fin(t.slippage) ? t.costs + t.slippage : null;
  const reserve = p.mode === 'prop' && fin(p.reserve) ? p.reserve : 0;
  const limits: { v: number; s: RiskSummary['limitSource'] }[] = [];
  if (fin(t.maxRisk)) limits.push({ v: t.maxRisk, s: 'plan' });
  if (p.mode === 'prop' && fin(p.dailyLossRemaining)) limits.push({ v: p.dailyLossRemaining - reserve, s: 'daily_loss' });
  if (p.mode === 'prop' && fin(p.drawdownBuffer)) limits.push({ v: p.drawdownBuffer - reserve, s: 'drawdown' });
  const tightest = limits.length ? limits.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const caps = [t.maxContracts, p.mode === 'prop' ? p.maxContracts : undefined].filter((x): x is number => fin(x) && x > 0);
  const contractCap = caps.length ? Math.min(...caps) : null;
  const byDollars = tightest && riskPerContract && riskPerContract > 0 ? Math.floor(Math.max(0, tightest.v - (costs ?? 0)) / riskPerContract) : null;
  const maxAllowedContracts = byDollars != null && contractCap != null ? Math.min(byDollars, contractCap) : (byDollars ?? contractCap);
  const failed = (id: string) => evaluation.riskChecks.some((c) => c.id === id && c.status === 'FAIL') || evaluation.propChecks.some((c) => c.id === id && c.status === 'FAIL');
  return {
    pointRisk,
    riskPerContract,
    costs,
    contracts: fin(t.quantity) ? t.quantity : null,
    dollarRisk: evaluation.dollarRisk,
    reward: evaluation.reward,
    rr: evaluation.rr,
    minimumRR: fin(t.minimumRR) ? t.minimumRR : null,
    maxRisk: fin(t.maxRisk) ? t.maxRisk : null,
    riskLimit: tightest?.v ?? null,
    limitSource: tightest?.s ?? null,
    contractCap,
    maxAllowedContracts,
    riskCapExceeded: failed('budget') || failed('buffers'),
    contractsExceeded: failed('contracts') || failed('contracts_plan'),
    rrBelowMinimum: failed('rr'),
    stopTooWide: tightest != null && riskPerContract != null && riskPerContract + (costs ?? 0) > tightest.v,
  };
}
