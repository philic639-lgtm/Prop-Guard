import type { IccSummary, SetupEvaluation } from '@/lib/engines/setupCheck';
import type { SetupCheck } from '@/types/domain';

import type { SetupForm } from './controller';

/** A saved Setup Check — exactly the engine's result plus the inputs it was computed from. */
export function toSetupCheck(a: {
  id: string;
  now: string;
  evaluation: SetupEvaluation;
  evaluatedBy: 'server' | 'device';
  form: SetupForm;
  strategyName: string;
  strategyVersion: string;
  analysisId: number | null;
  analysisKey: string | null;
  screenshotUri: string | null;
  icc?: IccSummary | null;
}): SetupCheck {
  const e = a.evaluation;
  const f = a.form;
  return {
    id: a.id,
    version: 2,
    createdAt: a.now,
    accountId: f.accountId,
    strategyId: f.strategyId ?? '',
    strategyName: a.strategyName,
    strategyVersion: a.strategyVersion,
    instrument: f.instrument,
    timeframe: f.timeframe,
    direction: f.side === 'LONG' ? 'long' : f.side === 'SHORT' ? 'short' : 'unsure',
    decision: e.decision,
    ruleAlignmentScore: e.ruleAlignmentScore,
    evidenceConfidence: e.evidenceConfidence,
    riskCheck: e.riskCheck as SetupCheck['riskCheck'],
    propFirmCompliance: e.propFirmCompliance as SetupCheck['propFirmCompliance'],
    passedRequired: e.passedRequired,
    totalRequired: e.totalRequired,
    evaluatedRules: e.evaluatedRules,
    riskChecks: e.riskChecks,
    propChecks: e.propChecks,
    blockers: e.blockers,
    dollarRisk: e.dollarRisk,
    reward: e.reward,
    rr: e.rr,
    analysisMode: e.analysisMode,
    evaluatedBy: a.evaluatedBy,
    analysisId: a.analysisId,
    analysisKey: a.analysisKey,
    inputs: { entry: f.entry, stop: f.stop, target: f.target, target2: f.target2, quantity: f.quantity, costs: f.costs, slippage: f.slippage, reserve: f.reserve },
    icc: a.icc ?? null,
    notes: f.notes,
    screenshotUri: a.screenshotUri,
    screenshotPath: null,
    tradeId: null,
    saved: false,
  };
}
