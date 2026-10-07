// SHARED, dependency-free (synced to supabase/functions/_shared/setupCheck).
// Unified Setup Check decision: one clear status with exact, rule-based
// reasons. It REFINES the engine's verdict — it never upgrades it:
//
//   engine TAKE TRADE                                  → QUALIFIED
//   a critical strategy rule failed / no ICC pattern   → STAND_DOWN
//   (or a weak match with failed conditions)
//   a hard risk or prop-firm rule failed               → BLOCKED
//   strategy confirmations still pending               → WAIT
//   only inputs / verifications missing (or demo)      → NEEDS_INPUT (shown as WAIT)
//
// The setup-match score explains how much of the trader's OWN saved strategy
// is confirmed (weighted by condition type). It never overrides a missing
// mandatory confirmation, a risk limit or a prop-firm rule.
import type { AccountRiskState } from './context';
import type { AnalysisMode, Check, Input, SetupEvaluation, Source, Status } from './engine';
import { setupStateOf, type SetupEventType } from './events';
import type { IccSummary } from './icc';
import { NONBINDING_DAILY_LIMIT, riskSummary, type RiskSummary } from './risk';
import type { SetupRule } from './rules';

export type SetupStatus = 'QUALIFIED' | 'WAIT' | 'STAND_DOWN' | 'BLOCKED' | 'NEEDS_INPUT';
export type SetupDisplayStatus = 'QUALIFIED' | 'WAIT' | 'STAND_DOWN' | 'BLOCKED';
export type ConditionCategory = 'bias' | 'context' | 'formation' | 'liquidity' | 'displacement' | 'confirmation' | 'trigger' | 'invalidation' | 'direction' | 'stop' | 'session' | 'confluence';
export type ConditionState = 'matched' | 'failed' | 'pending';

/** Relative weight of each condition type in the match score (split across the rules of that type). */
export const CATEGORY_WEIGHT: Record<ConditionCategory, number> = {
  bias: 15,
  context: 5,
  formation: 15,
  liquidity: 10,
  displacement: 10,
  confirmation: 20,
  trigger: 15,
  invalidation: 10,
  direction: 5,
  stop: 10,
  session: 10,
  confluence: 5,
};

export const CATEGORY_LABEL: Record<ConditionCategory, string> = {
  bias: 'Bias / context',
  context: 'Market / instrument',
  formation: 'Setup formation',
  liquidity: 'Liquidity',
  displacement: 'Displacement / momentum',
  confirmation: 'Confirmation',
  trigger: 'Entry trigger',
  invalidation: 'Invalidation',
  direction: 'Direction',
  stop: 'Stop / invalidation quality',
  session: 'Time / session',
  confluence: 'Optional confluence',
};

export interface MatchCondition {
  id: string;
  label: string;
  category: ConditionCategory;
  /** Points this condition contributes to the 0–100 score when matched. */
  weight: number;
  mandatory: boolean;
  critical: boolean;
  state: ConditionState;
  reason: string;
  source: Source | null;
}

export interface SetupMatch {
  score: number;
  conditions: MatchCondition[];
  matched: MatchCondition[];
  failed: MatchCondition[];
  pending: MatchCondition[];
}

export interface PropRuleResult {
  id: 'rules_current' | 'position_size' | 'daily_loss' | 'drawdown' | 'consistency' | 'account_restrictions' | 'live_state';
  label: string;
  status: Status;
  reason: string;
}

export type StageCode = 'INDICATION_ONLY' | 'CORRECTION_IN_PROGRESS' | 'AWAITING_CONFIRMATION' | 'CONFIRMED' | 'INVALIDATED' | 'NOT_IDENTIFIED' | 'NOT_ASSESSED' | 'SETUP_FORMING' | 'CONFIRMATION_COMPLETE' | 'NO_MATCH';
export type AnalysisConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SetupDecision {
  status: SetupStatus;
  displayStatus: SetupDisplayStatus;
  /** Sub-label for NEEDS_INPUT (shown as WAIT). */
  statusNote: string | null;
  headline: string;
  action: string;
  /** Alert-style message (WAIT) — the same text a future setup alert would carry. */
  alert: string | null;
  strategyName: string;
  match: SetupMatch;
  stage: { code: StageCode; label: string };
  /** ICC only: the three stages, visibly. */
  icc: { stages: { n: 1 | 2 | 3; label: string; state: 'done' | 'active' | 'pending' | 'failed' }[] } | null;
  entryQuality: 'Strong' | 'Good' | 'Fair' | 'Weak' | null;
  checklist: { id: string; label: string; state: ConditionState }[];
  risk: RiskSummary;
  levels: { entry: number | null; invalidation: number | null; stop: number | null; tp1: number | null; tp2: number | null };
  prop: { applicable: boolean; rows: PropRuleResult[] };
  blocking: { label: string; detail: string }[];
  confidence: { level: AnalysisConfidence; basis: 'chart' | 'manual' | 'demo' | 'none'; notes: string[] };
  needsInput: string[];
  why: { summary: string; matched: string[]; missing: string[]; failed: string[]; riskViolations: string[]; propViolations: string[]; unverified: string[] };
  /** Lifecycle state for setup alerts (see events.ts). */
  event: SetupEventType | null;
}

// ───────────────────────────── Condition classification ─────────────────────────────

const ICC_CATEGORY: Record<string, ConditionCategory> = {
  icc_htf: 'bias',
  icc_indication: 'displacement',
  icc_correction: 'formation',
  icc_continuation: 'confirmation',
  icc_structure_intact: 'invalidation',
  icc_direction_match: 'direction',
  icc_stop_structural: 'stop',
};
/** Derived from the stage score itself — not separate strategy evidence. */
const DERIVED = new Set(['icc_quality', 'icc_quality_floor']);

function categorize(r: SetupRule): ConditionCategory {
  if (ICC_CATEGORY[r.id]) return ICC_CATEGORY[r.id];
  if (r.id === 'system_instrument') return 'context';
  if (r.id === 'system_entry_window') return 'session';
  if (r.id === 'bias_alignment') return 'bias';
  if (r.id.startsWith('trigger_')) return 'trigger';
  if (r.id.startsWith('confirm_') || r.id.startsWith('retest_')) return 'confirmation';
  if (r.id.startsWith('invalid_')) return 'invalidation';
  if (!r.required && !r.critical) return 'confluence';
  const t = `${r.label} ${r.description}`.toLowerCase();
  if (/liquidity|sweep|stop ?hunt|equal (highs|lows)|grab/.test(t)) return 'liquidity';
  if (/displacement|momentum|impulse|expansion|strong move/.test(t)) return 'displacement';
  if (/\bbias\b|trend|higher[- ]time|htf|1h|daily/.test(t)) return 'bias';
  if (/confirm|close[ds]? (above|below|beyond|outside|back)|retest|reclaim|hold/.test(t)) return 'confirmation';
  if (/\bentry\b|trigger|\benter\b/.test(t)) return 'trigger';
  if (/\bstop\b|invalidat/.test(t)) return 'stop';
  if (/time|session|window|news|open\b/.test(t)) return 'session';
  return 'formation';
}

export function setupMatch(rules: SetupRule[], evaluation: SetupEvaluation): SetupMatch {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const rows = evaluation.evaluatedRules.filter((e) => !DERIVED.has(e.id) && byId.has(e.id));
  const cats = rows.map((e) => categorize(byId.get(e.id)!));
  const count = new Map<ConditionCategory, number>();
  for (const c of cats) count.set(c, (count.get(c) ?? 0) + 1);
  const total = [...count.keys()].reduce((n, c) => n + CATEGORY_WEIGHT[c], 0);
  const conditions: MatchCondition[] = rows.map((e, i) => {
    const category = cats[i];
    const weight = total ? (CATEGORY_WEIGHT[category] / count.get(category)!) * (100 / total) : 0;
    return {
      id: e.id,
      label: e.label,
      category,
      weight: Math.round(weight * 10) / 10,
      mandatory: e.required || e.critical,
      critical: e.critical,
      state: e.status === 'PASS' ? 'matched' : e.status === 'FAIL' ? 'failed' : 'pending',
      reason: e.reason,
      source: e.source,
    };
  });
  const score = Math.round(conditions.filter((c) => c.state === 'matched').reduce((n, c) => n + c.weight, 0));
  return { score: Math.min(100, score), conditions, matched: conditions.filter((c) => c.state === 'matched'), failed: conditions.filter((c) => c.state === 'failed'), pending: conditions.filter((c) => c.state === 'pending') };
}

// ───────────────────────────── Prop-firm rows ─────────────────────────────

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function propRuleResults(input: Input, evaluation: SetupEvaluation, account: AccountRiskState | null): PropRuleResult[] {
  const p = input.prop;
  if (p.mode !== 'prop') return [];
  const check = (id: string) => evaluation.propChecks.find((c) => c.id === id);
  const live = p.liveStateConfirmed === true;
  const reserve = p.reserve ?? 0;
  const risk = evaluation.dollarRisk;
  const rows: PropRuleResult[] = [];
  const verified = check('verified');
  if (verified) rows.push({ id: 'rules_current', label: 'Firm rules verified & current', status: verified.status, reason: verified.reason });
  const size = check('contracts');
  if (size)
    rows.push({ id: 'position_size', label: 'Position size', status: size.status, reason: size.status === 'UNVERIFIED' ? size.reason : `Maximum ${p.maxContracts} (micro-normalized); current ${input.trade.quantity}.` });
  // Buffers are computed from the journal — never a silent PASS without the trader's live confirmation.
  const buffer = (id: 'daily_loss' | 'drawdown', label: string, remaining: number | undefined, missing: string) => {
    if (remaining == null) return rows.push({ id, label, status: 'UNVERIFIED', reason: missing });
    if (id === 'daily_loss' && remaining >= NONBINDING_DAILY_LIMIT / 2) return rows.push({ id, label, status: 'PASS', reason: 'You confirmed this account has no daily loss limit.' });
    const room = remaining - reserve;
    if (room <= 0) return rows.push({ id, label, status: 'FAIL', reason: `No room left: ${money(Math.max(0, remaining))} remaining${reserve ? ` with a ${money(reserve)} reserve` : ''}.` });
    if (risk == null) return rows.push({ id, label, status: 'UNVERIFIED', reason: `${money(room)} remaining — calculate the trade risk to check it.` });
    if (risk >= room) return rows.push({ id, label, status: 'FAIL', reason: `${label} would be exceeded: this trade risks ${money(risk)}, ${money(room)} remaining.` });
    return rows.push({ id, label, status: live ? 'PASS' : 'UNVERIFIED', reason: live ? `Risk ${money(risk)} stays inside the ${money(room)} remaining (you confirmed your live account state).` : `${money(room)} remaining per your journal — live P&L is not connected. Confirm it in your trading platform.` });
  };
  buffer('daily_loss', 'Daily loss limit', p.dailyLossRemaining, 'No daily loss limit on file — confirm the firm’s limit, or that none applies to this account.');
  buffer('drawdown', account?.drawdownType === 'static' ? 'Max drawdown' : 'Trailing drawdown', p.drawdownBuffer, 'No drawdown rule on file — confirm the firm’s drawdown for this account.');
  const firm = evaluation.propChecks.filter((c) => c.id.startsWith('firm:'));
  const consistency = firm.find((c) => c.id === 'firm:consistency');
  if (consistency || account?.consistencyPct)
    rows.push({ id: 'consistency', label: 'Consistency rule', status: consistency?.status ?? 'UNVERIFIED', reason: consistency?.reason ?? `Largest day may not exceed ${account!.consistencyPct}% of profit — needs your payout-cycle P&L.` });
  const other = firm.filter((c) => c.id !== 'firm:consistency');
  const agg: Status = !other.length ? 'UNVERIFIED' : other.some((c) => c.status === 'FAIL') ? 'FAIL' : other.some((c) => c.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
  rows.push({ id: 'account_restrictions', label: 'Account type restrictions', status: agg, reason: !other.length ? (check('other')?.reason ?? 'Confirm other firm restrictions.') : agg === 'PASS' ? 'You confirmed the firm’s other restrictions.' : (other.find((c) => c.status !== 'PASS')!.reason ?? 'Confirm the firm’s other restrictions.') });
  const liveRow = check('live');
  if (liveRow) rows.push({ id: 'live_state', label: 'Live account state', status: liveRow.status, reason: liveRow.reason });
  return rows;
}

// ───────────────────────────── Decision ─────────────────────────────

const ICC_STAGE: Record<string, { code: StageCode; label: string }> = {
  'NO CLEAR ICC SETUP': { code: 'NOT_IDENTIFIED', label: 'No ICC pattern identified' },
  'WAIT — INDICATION ONLY': { code: 'INDICATION_ONLY', label: 'Indication only' },
  'WAIT — CORRECTION DEVELOPING': { code: 'CORRECTION_IN_PROGRESS', label: 'Correction in progress' },
  'WAIT — CONTINUATION NOT CONFIRMED': { code: 'AWAITING_CONFIRMATION', label: 'Awaiting confirmation' },
  'VALID ICC LONG': { code: 'CONFIRMED', label: 'Confirmed' },
  'VALID ICC SHORT': { code: 'CONFIRMED', label: 'Confirmed' },
  'ICC SETUP INVALIDATED': { code: 'INVALIDATED', label: 'Invalidated' },
};

const HARD_RISK = new Set(['budget', 'contracts_plan', 'rr']);
const INPUT_ERRORS = new Set(['direction', 'numeric']);
const list = (xs: string[], n = 2) => (xs.length <= n ? xs.join(' and ') : `${xs.slice(0, n).join(', ')} and ${xs.length - n} more`);

export function decideSetup(a: {
  rules: SetupRule[];
  input: Input;
  evaluation: SetupEvaluation;
  icc: IccSummary | null;
  strategyName: string;
  account: AccountRiskState | null;
  levels: { entry: number | null; stop: number | null; target: number | null; target2: number | null };
}): SetupDecision {
  const { evaluation: ev, input, icc } = a;
  const match = setupMatch(a.rules, ev);
  const risk = riskSummary(input, ev);
  const propRows = propRuleResults(input, ev, a.account);
  const kind = new Map(a.rules.map((r) => [r.id, r.kind]));
  const chartRules = match.conditions.filter((c) => kind.get(c.id) !== 'system');
  const critFail = match.conditions.filter((c) => c.critical && c.state === 'failed');
  const riskFails = ev.riskChecks.filter((c) => c.status === 'FAIL');
  const hardRisk = riskFails.filter((c) => HARD_RISK.has(c.id));
  const inputErrors = riskFails.filter((c) => INPUT_ERRORS.has(c.id));
  const propFails = ev.propChecks.filter((c) => c.status === 'FAIL');
  const pendingMandatory = match.pending.filter((c) => c.mandatory);
  const failedMandatory = match.failed.filter((c) => c.mandatory);
  const assessed = chartRules.some((c) => c.state !== 'pending');
  const iccStage = icc ? ICC_STAGE[icc.patternStatus] : null;
  const iccNoSetup = !!icc && (icc.patternStatus === 'ICC SETUP INVALIDATED' || (icc.patternStatus === 'NO CLEAR ICC SETUP' && icc.indication.value != null));

  // ── confidence: never fabricate what the chart did not show ──
  const notes: string[] = [];
  const lowVision = match.conditions.filter((c) => c.mandatory && c.source === 'vision' && c.state === 'pending');
  for (const c of lowVision) notes.push(`Could not confidently confirm “${c.label}” from this image — confirm it yourself.`);
  const obs = icc?.observation;
  if (obs && obs.source === 'vision' && !obs.counted) notes.push('The chart reading of the ICC stages was low-confidence — confirm each stage yourself.');
  if (obs && obs.source === 'vision' && ev.analysisMode === 'REAL') {
    if (obs.data.levels.stop == null && a.levels.stop == null) notes.push('Could not confidently identify the exact stop level from this image — enter it manually.');
    if (obs.data.levels.entry == null && a.levels.entry == null) notes.push('Could not confidently identify an entry level from this image — enter it manually.');
    if (obs.data.levels.tp1 == null && a.levels.target == null) notes.push('Could not identify a structural target from this image — enter TP1 manually.');
  }
  const mode: AnalysisMode = ev.analysisMode;
  const visionCounted = match.conditions.filter((c) => c.source === 'vision' && c.state !== 'pending');
  const basis: SetupDecision['confidence']['basis'] = mode === 'DEMO' ? 'demo' : mode === 'REAL' && (visionCounted.length || lowVision.length || obs?.source === 'vision') ? 'chart' : match.conditions.some((c) => c.source === 'manual') ? 'manual' : 'none';
  if (basis === 'demo') notes.push('Demo readings are simulated and never count.');
  const minVision = Math.min(1, ...ev.evaluatedRules.filter((r) => r.source === 'vision' && r.status !== 'UNVERIFIED').map((r) => r.confidence));
  const level: AnalysisConfidence = basis === 'chart' ? (lowVision.length || (obs?.source === 'vision' && !obs.counted) ? 'LOW' : minVision < 0.9 ? 'MEDIUM' : 'HIGH') : basis === 'manual' ? (pendingMandatory.some((c) => kind.get(c.id) !== 'system') ? 'MEDIUM' : 'HIGH') : 'LOW';

  // ── status ──
  let status: SetupStatus;
  if (ev.decision === 'TAKE TRADE') status = 'QUALIFIED';
  else if (critFail.length || iccNoSetup) status = 'STAND_DOWN';
  else if (!icc && failedMandatory.length && match.score < 50) status = 'STAND_DOWN';
  else if (hardRisk.length || propFails.length) status = 'BLOCKED';
  else if (inputErrors.length || !assessed) status = 'NEEDS_INPUT';
  else if (pendingMandatory.some((c) => kind.get(c.id) !== 'system') || failedMandatory.length) status = 'WAIT';
  else status = 'NEEDS_INPUT';

  // ── stage ──
  const confirmCats = new Set<ConditionCategory>(['confirmation', 'trigger']);
  const stage: SetupDecision['stage'] = iccStage
    ? iccStage
    : status === 'QUALIFIED' || (status === 'BLOCKED' && !pendingMandatory.length && !failedMandatory.length)
      ? { code: 'CONFIRMATION_COMPLETE', label: 'Confirmation complete' }
      : status === 'STAND_DOWN'
        ? { code: 'NO_MATCH', label: 'No match to your saved setup' }
        : !assessed
          ? { code: 'NOT_ASSESSED', label: 'Not assessed yet' }
          : [...pendingMandatory, ...failedMandatory].every((c) => confirmCats.has(c.category))
            ? { code: 'AWAITING_CONFIRMATION', label: 'Awaiting confirmation' }
            : { code: 'SETUP_FORMING', label: 'Setup forming' };

  const iccRail: SetupDecision['icc'] = icc
    ? {
        stages: [
          { n: 1, label: 'Indication', state: icc.indication.value === 'CONFIRMED' ? 'done' : icc.indication.value === 'NOT_PRESENT' ? 'failed' : icc.indication.value ? 'active' : 'pending' },
          { n: 2, label: 'Correction', state: icc.correction.value === 'CONFIRMED' || icc.correction.value === 'TOO_DEEP' ? 'done' : icc.correction.value === 'INVALIDATED' ? 'failed' : icc.correction.value && icc.correction.value !== 'NOT_PRESENT' ? 'active' : 'pending' },
          { n: 3, label: 'Confirmation', state: icc.continuation.value === 'CONFIRMED' ? 'done' : icc.continuation.value === 'FAILED' ? 'failed' : icc.continuation.value === 'DEVELOPING' ? 'active' : 'pending' },
        ],
      }
    : null;

  // ── blocking rules (exact numbers) ──
  const blocking: SetupDecision['blocking'] = [];
  const t = input.trade;
  for (const c of hardRisk) {
    if (c.id === 'budget') blocking.push({ label: 'Max risk per trade', detail: `Max risk allowed: ${money(t.maxRisk ?? 0)} · Current risk: ${money(ev.dollarRisk ?? 0)}` });
    if (c.id === 'contracts_plan') blocking.push({ label: 'Max contracts', detail: `Maximum contracts allowed: ${t.maxContracts} · Current size: ${t.quantity}` });
    if (c.id === 'rr') blocking.push({ label: 'Minimum R:R', detail: `Minimum R:R: ${t.minimumRR} · Current: ${ev.rr?.toFixed(2)}` });
  }
  for (const r of propRows.filter((x) => x.status === 'FAIL')) blocking.push({ label: `Prop firm rule: ${r.label}`, detail: r.id === 'position_size' ? `Maximum contracts allowed: ${input.prop.maxContracts} · Current size: ${t.quantity}` : r.reason });
  for (const c of propFails.filter((x) => x.id === 'buffers' || x.id === 'duplicates')) if (!propRows.some((r) => r.status === 'FAIL' && (r.id === 'daily_loss' || r.id === 'drawdown'))) blocking.push({ label: 'Prop firm rule: account buffers', detail: c.reason });

  // ── inputs Prop Guard needs (never guessed) ──
  const needsInput = [
    ...inputErrors.map((c) => c.reason),
    ...ev.riskChecks.filter((c) => c.status === 'UNVERIFIED').map((c) => c.reason),
    ...propRows.filter((r) => r.status === 'UNVERIFIED').map((r) => `${r.label}: ${r.reason}`),
    ...notes.filter((n) => n.startsWith('Could not')),
    ...ev.blockers.filter((b) => b.id === 'demo').map((b) => b.reason),
  ];
  if (!assessed) needsInput.unshift(obs || mode === 'REAL' ? 'Confirm your strategy rules — the chart reading could not confirm them.' : 'Upload a chart or confirm each of your strategy rules.');

  // ── wording ──
  const matchedLabels = match.matched.map((c) => c.label);
  const strategyComplete = !pendingMandatory.length && !failedMandatory.length;
  const n = match.conditions.filter((c) => c.mandatory).length;
  const m = match.conditions.filter((c) => c.mandatory && c.state === 'matched').length;
  const iccNeed = stage.code === 'INDICATION_ONLY' ? 'a correction and then confirmation before entry' : stage.code === 'CORRECTION_IN_PROGRESS' ? 'the correction to finish and then confirmation before entry' : 'confirmation after the correction before entry';
  let headline: string;
  let action: string;
  let summary: string;
  let alert: string | null = null;
  switch (status) {
    case 'QUALIFIED':
      headline = 'Setup meets your saved rules';
      action = 'Setup currently meets your saved rules. Review risk before entry — this is rule compliance, not a prediction.';
      summary = `QUALIFIED because all ${n} required conditions of your ${a.strategyName} rules are confirmed, risk is within your limits${propRows.length ? ' and every prop-firm check passed' : ''}.`;
      break;
    case 'WAIT':
      headline = 'Your setup is forming';
      action = 'Prepare, but do not enter yet.';
      alert = 'Your setup is forming. Get ready and manage risk, but wait for confirmation.';
      summary = icc
        ? `WAIT because ${m} of ${n} strategy conditions are satisfied, but your saved ICC rules require ${iccNeed}.`
        : `WAIT because ${m} of ${n} strategy conditions are satisfied, but your saved ${a.strategyName} rules still require ${list([...pendingMandatory, ...failedMandatory].map((c) => c.label))} before entry.`;
      break;
    case 'NEEDS_INPUT':
      headline = 'More information needed';
      action = 'Add the missing details — Prop Guard won’t guess them.';
      summary = `WAIT because Prop Guard can’t verify everything yet: ${needsInput[0] ?? 'some required information is missing'}`;
      break;
    case 'STAND_DOWN':
      headline = icc?.patternStatus === 'ICC SETUP INVALIDATED' ? 'Your ICC setup was invalidated' : critFail.length ? 'This setup breaks a rule in your saved strategy' : 'No clear match to your saved setup';
      action = 'Do not force the trade. Wait for a cleaner setup.';
      summary = critFail.length
        ? `STAND DOWN because ${list(critFail.map((c) => c.label))} ${critFail.length === 1 ? 'is' : 'are'} not met — ${critFail.length === 1 ? 'it is' : 'they are'} critical in your saved rules.`
        : icc
          ? `STAND DOWN because ${icc.statusReason.replace(/\.$/, '').toLowerCase()}.`
          : `STAND DOWN because only ${m} of ${n} conditions match your saved ${a.strategyName} setup (${match.score}% match).`;
      break;
    default:
      headline = strategyComplete ? 'Strategy setup is valid, but this trade violates your risk rules' : 'This trade breaks a hard risk rule';
      if (propFails.length && !hardRisk.length) headline = strategyComplete ? 'Strategy setup is valid, but this trade violates your prop-firm rules' : 'This trade breaks a prop-firm rule';
      action = 'Reduce risk or stand down.';
      summary = `BLOCKED because ${blocking[0] ? `${blocking[0].label.toLowerCase()} — ${blocking[0].detail}` : 'a hard risk or prop-firm rule fails'}.`;
  }

  const entryScore = icc ? Math.min(match.score, icc.score.total) : match.score;
  const entryQuality = status === 'QUALIFIED' || (status === 'BLOCKED' && strategyComplete) ? (entryScore >= 85 ? 'Strong' : entryScore >= 70 ? 'Good' : entryScore >= 55 ? 'Fair' : 'Weak') : null;

  const riskRow = (id: string) => ev.riskChecks.find((c) => c.id === id);
  const state = (s: Status | undefined): ConditionState => (s === 'PASS' ? 'matched' : s === 'FAIL' ? 'failed' : 'pending');
  const checklist: SetupDecision['checklist'] = [
    ...match.conditions.filter((c) => c.mandatory).map((c) => ({ id: c.id, label: c.label, state: c.state })),
    { id: 'risk:direction', label: 'Stop / target on the correct side', state: state(riskRow('direction')?.status) },
    { id: 'risk:budget', label: 'Risk within your max', state: state(riskRow('budget')?.status) },
    ...(riskRow('rr') ? [{ id: 'risk:rr', label: 'R:R meets your minimum', state: state(riskRow('rr')!.status) }] : []),
    ...(riskRow('contracts_plan') ? [{ id: 'risk:contracts', label: 'Contracts within your limit', state: state(riskRow('contracts_plan')!.status) }] : []),
    ...(propRows.length ? [{ id: 'prop', label: 'Prop firm rules passed', state: state(ev.propFirmCompliance === 'NOT_APPLICABLE' ? undefined : (ev.propFirmCompliance as Status)) }] : []),
  ];

  const unverifiedRisk = [...ev.riskChecks, ...ev.propChecks].filter((c: Check) => c.status === 'UNVERIFIED').map((c) => `${c.label}: ${c.reason}`);
  return {
    status,
    displayStatus: status === 'NEEDS_INPUT' ? 'WAIT' : status,
    statusNote: status === 'NEEDS_INPUT' ? 'Needs your input' : null,
    headline,
    action,
    alert,
    strategyName: a.strategyName,
    match,
    stage,
    icc: iccRail,
    entryQuality,
    checklist,
    risk,
    levels: {
      entry: a.levels.entry,
      // ICC: the correction extreme, only from a trusted (counted) chart reading — never a guess.
      invalidation: icc?.observation?.counted ? ((icc.direction === 'BEARISH' ? icc.observation.data.correction.zoneHigh : icc.observation.data.correction.zoneLow) ?? null) : null,
      stop: a.levels.stop,
      tp1: a.levels.target,
      tp2: a.levels.target2,
    },
    prop: { applicable: propRows.length > 0, rows: propRows },
    blocking,
    confidence: { level, basis, notes },
    needsInput: [...new Set(needsInput)],
    why: {
      summary,
      matched: matchedLabels,
      missing: pendingMandatory.map((c) => `${c.label} — ${c.reason}`),
      failed: match.failed.map((c) => `${c.label} — ${c.reason}`),
      riskViolations: riskFails.map((c) => `${c.label}: ${c.reason}`),
      propViolations: propRows.filter((r) => r.status === 'FAIL').map((r) => `${r.label}: ${r.reason}`),
      unverified: [...new Set([...unverifiedRisk, ...notes])],
    },
    event: setupStateOf({ strategyId: '', status, stage: stage.code, matchScore: match.score, assessed }),
  };
}
