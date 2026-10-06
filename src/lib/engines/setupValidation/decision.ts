import type { CriterionResult, Grade, SetupCheckOutcome, SetupCriterion, SetupDecision, VisionOutput } from './types';
import { VisionOutputSchema } from './types';

/**
 * SetupDecisionEngine — deterministic. The vision model only reports evidence
 * per rule; this code decides:
 *   any REQUIRED rule FAILS            → STAND_DOWN
 *   else any REQUIRED rule UNVERIFIED  → WAIT
 *   else (all required PASS)           → QUALIFIED
 * Optional rules affect the score only. The score never overrides a required
 * failure.
 */

/** Below this the screenshot is too poor to trust any visual reading. */
export const MIN_IMAGE_QUALITY = 40;
/** A visual PASS below this confidence is treated as UNVERIFIED. */
export const MIN_PASS_CONFIDENCE = 0.6;

// ───────────────────────────── AI output validation / repair ─────────────────────────────

export type VisionParse = { ok: true; output: VisionOutput; repairs: string[] } | { ok: false; error: string };

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Validate (and safely repair) the model's response. Anything that cannot be
 * repaired is rejected — never guessed. Unknown rule ids are dropped; rules
 * the model skipped become UNVERIFIED. A `finalStatus` from the model is ignored.
 */
export function parseVisionOutput(raw: unknown, criteria: SetupCriterion[]): VisionParse {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, error: 'The AI response was not valid JSON.' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'The AI response was empty or malformed.' };
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.criteria)) return { ok: false, error: 'The AI response had no rule results.' };

  const repairs: string[] = [];
  if ('finalStatus' in o || 'decision' in o) repairs.push('Ignored a final status suggested by the AI — Prop Guard decides.');
  const visualIds = new Set(criteria.filter((c) => c.kind === 'visual').map((c) => c.id));
  const statuses = new Set(['PASS', 'FAIL', 'UNVERIFIED', 'NOT_APPLICABLE']);
  const seen = new Set<string>();
  const rows: VisionOutput['criteria'] = [];
  for (const item of o.criteria as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = str(r.ruleId, 120);
    if (!visualIds.has(id) || seen.has(id)) {
      if (id) repairs.push(`Dropped an unknown or duplicate rule id from the AI (${id}).`);
      continue;
    }
    seen.add(id);
    let status = str(r.status, 20).toUpperCase().replace(/[\s-]/g, '_');
    if (status === 'N/A' || status === 'NA') status = 'NOT_APPLICABLE';
    if (!statuses.has(status)) {
      repairs.push(`Rule ${id}: unknown status treated as UNVERIFIED.`);
      status = 'UNVERIFIED';
    }
    rows.push({ ruleId: id, ruleName: str(r.ruleName, 200), status: status as VisionOutput['criteria'][number]['status'], evidence: str(r.evidence, 600), confidence: clamp(r.confidence, 0, 1, 0) });
  }
  const chart = (o.chart && typeof o.chart === 'object' ? o.chart : {}) as Record<string, unknown>;
  const risk = (o.riskEvidence && typeof o.riskEvidence === 'object' ? o.riskEvidence : {}) as Record<string, unknown>;
  const iq = (o.imageQuality && typeof o.imageQuality === 'object' ? o.imageQuality : {}) as Record<string, unknown>;
  if (!o.imageQuality) repairs.push('No image-quality score from the AI — treated as poor.');
  const dir = str(chart.directionObserved, 10);
  const candidate = {
    chart: {
      instrument: str(chart.instrument, 200) || null,
      timeframe: str(chart.timeframe, 200) || null,
      directionObserved: dir === 'up' || dir === 'down' || dir === 'sideways' ? dir : null,
      marketCondition: str(chart.marketCondition, 200) || null,
    },
    criteria: rows,
    riskEvidence: { entry: numOrNull(risk.entry), stop: numOrNull(risk.stop), target: numOrNull(risk.target), pricesConfidence: clamp(risk.pricesConfidence, 0, 1, 0) },
    imageQuality: { score: clamp(iq.score, 0, 100, 0), issues: Array.isArray(iq.issues) ? iq.issues.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 12) : [] },
    summary: str(o.summary, 800),
  };
  const parsed = VisionOutputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: 'The AI response did not match the required format.' };
  return { ok: true, output: parsed.data, repairs };
}

// ───────────────────────────── Language guard ─────────────────────────────

/** Wording Prop Guard never shows: predictions, instructions to trade, guarantees. */
export const BANNED_LANGUAGE = /\b(take (this|the) trade|buy now|sell now|enter now|guarantee(d|s)?|sure thing|can'?t lose|cannot lose|winner|winning trade|will (win|profit|make money|go up|go down)|risk[- ]free|easy money)\b/gi;

export const cleanLanguage = (s: string) => s.replace(BANNED_LANGUAGE, '[removed]').replace(/\s+/g, ' ').trim();

// ───────────────────────────── Merge vision + app criteria ─────────────────────────────

/**
 * Visual criteria take the model's status — downgraded to UNVERIFIED when the
 * image is too poor, the confidence too low, or the model said nothing.
 * Missing evidence never becomes a PASS.
 */
export function visualResults(criteria: SetupCriterion[], vision: VisionOutput | null, opts: { mock?: boolean } = {}): CriterionResult[] {
  const quality = vision?.imageQuality.score ?? 0;
  const poor = !vision || quality < MIN_IMAGE_QUALITY;
  return criteria
    .filter((c) => c.kind === 'visual')
    .map((c) => {
      const r = vision?.criteria.find((x) => x.ruleId === c.id);
      const base = { ruleId: c.id, ruleName: c.name, required: c.required, weight: c.weight, kind: c.kind, origin: c.origin };
      if (!r) return { ...base, status: 'UNVERIFIED' as const, evidence: vision ? 'The analysis returned no evidence for this rule.' : 'No chart analysis available.', confidence: 0 };
      const evidence = cleanLanguage(r.evidence) || 'No evidence given.';
      if (poor && r.status !== 'NOT_APPLICABLE') return { ...base, status: 'UNVERIFIED' as const, evidence: `Screenshot quality too low to verify (${Math.round(quality)}/100). ${evidence}`, confidence: Math.min(r.confidence, 0.3) };
      if (r.status === 'PASS' && r.confidence < MIN_PASS_CONFIDENCE) return { ...base, status: 'UNVERIFIED' as const, evidence: `Not clear enough to confirm (confidence ${Math.round(r.confidence * 100)}%). ${evidence}`, confidence: r.confidence };
      // A required rule cannot be waved through as N/A by the model.
      if (r.status === 'NOT_APPLICABLE' && c.required) return { ...base, status: 'UNVERIFIED' as const, evidence: `Required by your plan — the analysis marked it not applicable. ${evidence}`, confidence: r.confidence };
      return { ...base, status: r.status, evidence: opts.mock ? `[DEMO] ${evidence}` : evidence, confidence: r.confidence };
    });
}

// ───────────────────────────── Decision, score, grade ─────────────────────────────

export function decide(results: CriterionResult[]): SetupDecision {
  const required = results.filter((r) => r.required);
  if (required.some((r) => r.status === 'FAIL')) return 'STAND_DOWN';
  if (required.some((r) => r.status === 'UNVERIFIED')) return 'WAIT';
  return 'QUALIFIED';
}

/** passedWeight / evaluatedWeight × 100 over PASS/FAIL only — UNVERIFIED is never rewarded. */
export function setupScore(results: CriterionResult[]): number | null {
  const evaluated = results.filter((r) => r.status === 'PASS' || r.status === 'FAIL');
  const total = evaluated.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return null;
  const passed = evaluated.filter((r) => r.status === 'PASS').reduce((s, r) => s + r.weight, 0);
  return Math.round((passed / total) * 100);
}

export function gradeFor(score: number | null): { grade: Grade | null; label: string } {
  if (score == null) return { grade: null, label: 'Not enough verified evidence' };
  if (score >= 90) return { grade: 'A', label: 'A — Excellent Rule Alignment' };
  if (score >= 80) return { grade: 'B', label: 'B — Strong Rule Alignment' };
  if (score >= 70) return { grade: 'C', label: 'C — Moderate Rule Alignment' };
  return { grade: 'WEAK', label: 'Weak Rule Alignment' };
}

/** Overall evidence confidence 0–100 (image quality × mean confidence of evaluated visual rules). */
export function evidenceConfidence(results: CriterionResult[], vision: VisionOutput | null): number {
  const visual = results.filter((r) => r.kind === 'visual');
  if (!visual.length) return vision ? Math.round(vision.imageQuality.score) : 0;
  const mean = visual.reduce((s, r) => s + (r.status === 'UNVERIFIED' ? 0 : r.confidence), 0) / visual.length;
  return Math.round(mean * (vision ? vision.imageQuality.score : 0));
}

const NOT_A_PREDICTION = 'This is rule compliance, not a prediction of profitability.';

export function outcomeOf(results: CriterionResult[], vision: VisionOutput | null): SetupCheckOutcome {
  const decision = decide(results);
  const score = setupScore(results);
  const { grade, label } = gradeFor(score);
  const required = results.filter((r) => r.required);
  const failedRequired = required.filter((r) => r.status === 'FAIL');
  const unverifiedRequired = required.filter((r) => r.status === 'UNVERIFIED');
  const requiredPassed = required.filter((r) => r.status === 'PASS').length;
  const optionalFails = results.filter((r) => !r.required && r.status === 'FAIL');

  let why: string;
  const next: string[] = [];
  if (decision === 'STAND_DOWN') {
    why = `${failedRequired.length} required rule${failedRequired.length === 1 ? '' : 's'} failed: ${failedRequired.map((r) => r.ruleName).join(', ')}. A high score cannot override a required rule.`;
    for (const r of failedRequired) next.push(`${r.ruleName}: ${r.evidence}`);
    next.push('Stand down on this setup — it breaks your saved rules.');
  } else if (decision === 'WAIT') {
    why = `${requiredPassed} of ${required.length} required conditions are confirmed. Still needed: ${unverifiedRequired.map((r) => r.ruleName).join(', ')}.`;
    for (const r of unverifiedRequired) next.push(`Confirm “${r.ruleName}” — ${r.evidence}`);
  } else {
    why = `All ${required.length} required rules are satisfied by the visible evidence and your inputs.`;
    next.push(`Setup satisfies all required saved rules. ${NOT_A_PREDICTION}`);
  }
  if (optionalFails.length) next.push(`Optional checks not met: ${optionalFails.map((r) => r.ruleName).join(', ')}.`);
  if (vision && vision.imageQuality.score < MIN_IMAGE_QUALITY) next.unshift('Upload a clearer or wider screenshot — the current one is too unclear to verify chart rules.');
  for (const issue of vision?.imageQuality.issues ?? []) if (!next.includes(issue)) next.push(cleanLanguage(issue));

  return {
    decision,
    score,
    grade,
    gradeLabel: label,
    why: cleanLanguage(why),
    next: next.map(cleanLanguage).slice(0, 10),
    requiredTotal: required.length,
    requiredPassed,
    failedRequired,
    unverifiedRequired,
    evidenceConfidence: evidenceConfidence(results, vision),
  };
}
