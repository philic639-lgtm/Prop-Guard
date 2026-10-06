import type { Account, Strategy } from '@/types/domain';
import { easternMinutes, formatClock, parseClock } from '@/utils/dates';

import { cleanNumber, findInstrument, pointsBetween, pointsToDollars } from '../instrumentEngine';
import { maxContractsForRisk } from '../riskEngine';

import type { CriterionResult, PropVerification, RiskContext, RiskNumbers, SetupCheckUserInput, VisionOutput } from './types';

/**
 * RiskRuleEvaluator — everything the app can check WITHOUT the model:
 * strategy fields (instrument, entry window, minimum R:R, stop), the trader's
 * personal risk rules / Daily Guard, and account / prop-firm limits.
 * Prop limits are hard rules only when verified in the firm rules database.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Chart-read prices are used only when the user gave none and the model is confident. */
const CHART_PRICE_MIN_CONFIDENCE = 0.7;

export function riskNumbers(input: SetupCheckUserInput, vision: VisionOutput | null, budget: number | null): RiskNumbers {
  const chartOk = !!vision && vision.riskEvidence.pricesConfidence >= CHART_PRICE_MIN_CONFIDENCE;
  const pick = (user: number | null, chart: number | null | undefined) => (isNum(user) ? { v: user, from: 'user' as const } : chartOk && isNum(chart) ? { v: chart, from: 'chart' as const } : { v: null, from: 'none' as const });
  const e = pick(input.entry, vision?.riskEvidence.entry);
  const s = pick(input.stop, vision?.riskEvidence.stop);
  const t = pick(input.target, vision?.riskEvidence.target);
  const froms = new Set([e.from, s.from, t.from].filter((f) => f !== 'none'));
  const pricesFrom = froms.size === 0 ? 'none' : froms.size === 1 ? [...froms][0] : 'mixed';
  const spec = findInstrument(input.instrument);
  const pointsRisk = isNum(e.v) && isNum(s.v) ? pointsBetween(e.v, s.v) : null;
  const pointsReward = isNum(e.v) && isNum(t.v) ? pointsBetween(e.v, t.v) : null;
  const rr = isNum(pointsRisk) && pointsRisk > 0 && isNum(pointsReward) ? cleanNumber(pointsReward / pointsRisk, 2) : null;
  const contracts = isNum(input.contracts) && input.contracts > 0 ? input.contracts : null;
  const riskDollars = spec && isNum(pointsRisk) ? pointsToDollars(input.instrument, pointsRisk, contracts ?? 1) : null;
  const rewardDollars = spec && isNum(pointsReward) ? pointsToDollars(input.instrument, pointsReward, contracts ?? 1) : null;
  const maxContractsForBudget = spec && isNum(e.v) && isNum(s.v) && isNum(budget) ? maxContractsForRisk(input.instrument, e.v, s.v, budget) : null;
  return { entry: e.v, stop: s.v, target: t.v, pricesFrom, pointsRisk, pointsReward, rr, contracts, riskDollars, rewardDollars, maxContractsForBudget };
}

/** Directional sanity: a long's stop below entry, target above (and vice versa). */
function directionProblem(input: SetupCheckUserInput, n: RiskNumbers): string | null {
  if (input.direction === 'unsure' || !isNum(n.entry)) return null;
  const long = input.direction === 'long';
  if (isNum(n.stop) && (long ? n.stop >= n.entry : n.stop <= n.entry)) return `For a ${input.direction}, the stop must be ${long ? 'below' : 'above'} entry.`;
  if (isNum(n.target) && (long ? n.target <= n.entry : n.target >= n.entry)) return `For a ${input.direction}, the target must be ${long ? 'above' : 'below'} entry.`;
  return null;
}

function result(r: Omit<CriterionResult, 'confidence'> & { confidence?: number }): CriterionResult {
  return { confidence: 1, ...r };
}

/** Strategy fields the app checks itself (instrument, window, stop, R:R). */
export function computedCriteria(strategy: Strategy, input: SetupCheckUserInput, n: RiskNumbers, now: Date, rules: RiskContext): CriterionResult[] {
  const out: CriterionResult[] = [];
  const base = { kind: 'computed' as const, origin: 'strategy_field' as const };

  if (strategy.markets.length) {
    const ok = strategy.markets.some((m) => m.toUpperCase() === input.instrument.toUpperCase());
    out.push(result({ ...base, ruleId: 'instrument_allowed', ruleName: 'Instrument in plan', required: true, weight: 10, status: ok ? 'PASS' : 'FAIL', evidence: ok ? `${input.instrument} is one of this strategy’s markets.` : `${input.instrument} is not in this strategy’s markets (${strategy.markets.join(', ')}).` }));
  }

  const start = parseClock(strategy.entryWindowStart);
  const end = parseClock(strategy.entryWindowEnd);
  if (start != null || end != null) {
    const m = easternMinutes(now);
    const inside = (start == null || m >= start) && (end == null || m <= end);
    const window = `${start != null ? formatClock(strategy.entryWindowStart) : 'open'} – ${end != null ? formatClock(strategy.entryWindowEnd) : 'close'} ET`;
    out.push(result({ ...base, ruleId: 'entry_window', ruleName: 'Entry window', required: true, weight: 10, status: inside ? 'PASS' : 'FAIL', evidence: inside ? `Now is inside the strategy’s entry window (${window}).` : `Now is outside the strategy’s entry window (${window}).` }));
  }

  const dirIssue = directionProblem(input, n);
  if (dirIssue) out.push(result({ ...base, ruleId: 'price_direction', ruleName: 'Prices match direction', required: true, weight: 10, status: 'FAIL', evidence: dirIssue }));

  if (rules.requireStop) {
    out.push(
      result({
        ...base,
        origin: 'risk_settings',
        ruleId: 'stop_defined',
        ruleName: 'Stop defined',
        required: true,
        weight: 10,
        status: isNum(n.stop) ? 'PASS' : 'UNVERIFIED',
        evidence: isNum(n.stop) ? `Stop at ${n.stop}${n.pricesFrom === 'chart' ? ' (read from the chart — confirm it)' : ''}.` : 'No stop price was entered or clearly visible. Your rules require a stop.',
      }),
    );
  }

  if (strategy.minRR > 0) {
    const rr = n.rr;
    out.push(
      result({
        ...base,
        ruleId: 'min_rr',
        ruleName: `Risk/Reward ≥ 1:${strategy.minRR}`,
        required: true,
        weight: 15,
        status: rr == null ? 'UNVERIFIED' : rr + 1e-9 >= strategy.minRR ? 'PASS' : 'FAIL',
        confidence: n.pricesFrom === 'user' ? 1 : n.pricesFrom === 'none' ? 0 : 0.7,
        evidence:
          rr == null
            ? 'Entry/stop/target prices are required to verify R:R.'
            : `Entry/stop/target equal about 1:${rr} (${n.pricesFrom === 'user' ? 'prices you entered' : 'prices read from the chart — confirm them'}); your minimum is 1:${strategy.minRR}.`,
      }),
    );
  }
  return out;
}

/** The trader's own risk rules and Daily Guard. Always enforced (they are the trader's rules). */
export function riskCriteria(n: RiskNumbers, ctx: RiskContext): CriterionResult[] {
  const out: CriterionResult[] = [];
  const base = { kind: 'risk' as const, required: true, weight: 10 };
  const g = ctx.guard;
  if (g) {
    if (g.status === 'STOP') {
      out.push(result({ ...base, origin: 'daily_guard', ruleId: 'daily_guard', ruleName: 'Daily Guard', status: 'FAIL', evidence: `Daily Guard says STOP: ${g.reasons.join('; ') || g.headline}.` }));
    }
    if (g.cooldownActive) out.push(result({ ...base, origin: 'risk_settings', ruleId: 'cooldown', ruleName: 'Cooldown after loss', status: 'FAIL', evidence: 'Your cooldown after a loss is still running.' }));
    if (g.tradesRemaining <= 0) out.push(result({ ...base, origin: 'risk_settings', ruleId: 'trades_remaining', ruleName: 'Max trades per day', status: 'FAIL', evidence: 'You have used all of today’s trades.' }));
  }
  const tradeRisk = n.riskDollars;
  if (isNum(ctx.maxRiskPerTrade) && ctx.maxRiskPerTrade > 0) {
    if (tradeRisk == null) {
      out.push(result({ ...base, origin: 'risk_settings', ruleId: 'max_risk_per_trade', ruleName: `Risk per trade ≤ ${money(ctx.maxRiskPerTrade)}`, status: 'UNVERIFIED', confidence: 0, evidence: 'Entry and stop prices are needed to size the risk.' }));
    } else {
      const over = tradeRisk > ctx.maxRiskPerTrade + 1e-6;
      const size = n.contracts ?? 1;
      out.push(
        result({
          ...base,
          origin: 'risk_settings',
          ruleId: 'max_risk_per_trade',
          ruleName: `Risk per trade ≤ ${money(ctx.maxRiskPerTrade)}`,
          status: over ? 'FAIL' : 'PASS',
          evidence: `${size} contract${size === 1 ? '' : 's'} risk ${money(tradeRisk)}${over ? `, above your ${money(ctx.maxRiskPerTrade)} limit` : ''}.${!n.contracts && n.maxContractsForBudget != null ? ` Max size within your budget: ${n.maxContractsForBudget}.` : ''}`,
        }),
      );
    }
  }
  if (g && tradeRisk != null) {
    const over = tradeRisk > g.riskRemaining + 1e-6;
    out.push(result({ ...base, origin: 'daily_guard', ruleId: 'daily_risk_remaining', ruleName: 'Daily loss budget', status: over ? 'FAIL' : 'PASS', evidence: over ? `A stop-out (${money(tradeRisk)}) would exceed today’s remaining loss budget (${money(g.riskRemaining)}).` : `A stop-out (${money(tradeRisk)}) stays within today’s remaining budget (${money(g.riskRemaining)}).` }));
  }
  return out;
}

const PROP_LABEL: Record<PropVerification, string> = {
  verified: 'Verified firm rule',
  account_setting: 'PROP RULE UNVERIFIED — value you entered',
  unverified: 'PROP RULE UNVERIFIED',
};

/**
 * Account / prop-firm limits. A limit is a HARD rule (required) only when it
 * is a verified firm rule; a value the trader entered is checked and shown
 * as a warning; a missing / unverified rule is never invented.
 */
export function propCriteria(n: RiskNumbers, ctx: RiskContext): CriterionResult[] {
  const a = ctx.account;
  if (!a || a.kind !== 'prop') return [];
  const out: CriterionResult[] = [];
  const add = (ruleId: string, ruleName: string, verification: PropVerification, status: CriterionResult['status'], evidence: string) =>
    out.push(result({ ruleId, ruleName, kind: 'prop', origin: 'account_rule', propVerification: verification, required: verification === 'verified' && status !== 'NOT_APPLICABLE', weight: 10, status, evidence: `${PROP_LABEL[verification]}. ${evidence}` }));

  const mc = a.maxContracts;
  if (mc.value == null) add('prop_max_contracts', 'Max contracts', 'unverified', 'NOT_APPLICABLE', 'No verified max-contract rule for this account — not enforced.');
  else if (n.contracts == null) add('prop_max_contracts', `Max contracts ≤ ${mc.value}`, mc.verification, 'UNVERIFIED', 'Enter your size to check it.');
  else add('prop_max_contracts', `Max contracts ≤ ${mc.value}`, mc.verification, n.contracts <= mc.value ? 'PASS' : 'FAIL', `${n.contracts} contract(s) vs limit ${mc.value}.`);

  const dd = ctx.guard?.drawdownBuffer;
  if (a.maxDrawdown.value == null) add('prop_drawdown', 'Max loss / drawdown', 'unverified', 'NOT_APPLICABLE', 'No verified drawdown rule for this account — not enforced.');
  else if (n.riskDollars == null || dd == null) add('prop_drawdown', 'Drawdown buffer', a.maxDrawdown.verification, 'UNVERIFIED', 'Entry and stop are needed to compare the risk with your drawdown buffer.');
  else add('prop_drawdown', 'Drawdown buffer', a.maxDrawdown.verification, n.riskDollars < dd ? 'PASS' : 'FAIL', n.riskDollars < dd ? `A stop-out (${money(n.riskDollars)}) leaves ${money(dd - n.riskDollars)} above the drawdown floor.` : `A stop-out (${money(n.riskDollars)}) would reach the drawdown floor (buffer ${money(dd)}).`);

  if (a.dailyLossLimit.value == null) add('prop_daily_loss', 'Daily loss limit', 'unverified', 'NOT_APPLICABLE', 'No verified daily loss limit for this account — not enforced.');

  for (const r of a.unverifiedFirmRules) add(`prop_unverified_${r.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`, r, 'unverified', 'NOT_APPLICABLE', 'The firm’s rule could not be verified — enter it yourself if it applies. Not enforced.');
  return out;
}

const RISK_RELEVANT = /loss|drawdown|contract|position|scaling|size/i;

/** Account → risk context fields, labelling every limit with its verification. */
export function accountRiskContext(account: Account | null, needsReview: string[] = []): RiskContext['account'] {
  if (!account) return null;
  const link = account.firmLink;
  const verification = (field: 'maxContracts' | 'dailyLossLimit' | 'maxDrawdown', value: number | null): PropVerification => {
    if (value == null) return 'unverified';
    return link?.status === 'verified' && link.imported[field] != null && !link.overrides.includes(field) ? 'verified' : 'account_setting';
  };
  return {
    name: account.name,
    firm: account.firm,
    kind: account.kind,
    maxContracts: { value: account.rules.maxContracts, verification: verification('maxContracts', account.rules.maxContracts) },
    dailyLossLimit: { value: account.rules.dailyLossLimit, verification: verification('dailyLossLimit', account.rules.dailyLossLimit) },
    maxDrawdown: { value: account.rules.maxDrawdown, verification: verification('maxDrawdown', account.rules.maxDrawdown) },
    // Only risk-relevant firm rules that could not be verified (loss limits, size, scaling) — shown, never enforced.
    unverifiedFirmRules: [...new Set([...needsReview, ...(link?.snapshot?.rules.filter((r) => r.status !== 'verified' && RISK_RELEVANT.test(r.label)).map((r) => r.label) ?? [])])],
  };
}
