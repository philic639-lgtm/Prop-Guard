import type { PracticeAttempt } from '@/types/practice';

/**
 * Personal practice analytics — computed ONLY from the trader's own practice
 * attempts. "Accuracy" means the decision matched the rule-based ideal
 * (LONG / SHORT / WAIT), not whether the trade made money.
 *
 * The helpers take any record with the fields they need, so the same functions
 * can later run over live-trade history.
 */

export const MIN_GROUP_ATTEMPTS = 5;
export const MIN_INSIGHT_ATTEMPTS = 10;
/** Accuracy gap (percentage points) before a difference is called out. */
export const MIN_INSIGHT_GAP = 0.15;

type Graded = Pick<PracticeAttempt, 'correct'>;

export interface AccuracyGroup {
  key: string;
  label: string;
  attempts: number;
  correct: number;
  accuracy: number;
  avgScore: number | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const directionLabel = (d: string) => (d === 'long' ? 'Long' : d === 'short' ? 'Short' : 'Wait');
export const retestLabel = (n: number | undefined) => (n == null ? 'No retest' : n === 0 ? 'No retest' : n === 1 ? 'First retest' : n === 2 ? 'Second retest' : n === 3 ? 'Third retest' : `Retest #${n}`);

export function accuracyOf(list: readonly Graded[]): number | null {
  return list.length ? list.filter((a) => a.correct).length / list.length : null;
}

export function calculateAverageScore(list: readonly Pick<PracticeAttempt, 'score'>[]): number | null {
  return list.length ? Math.round(list.reduce((s, a) => s + a.score, 0) / list.length) : null;
}

/** Group attempts by any key and compute accuracy per group. */
export function groupAccuracy<T extends Graded & Partial<Pick<PracticeAttempt, 'score'>>>(
  list: readonly T[],
  keyOf: (a: T) => string | null,
  labelOf: (key: string, sample: T) => string = (k) => k,
): AccuracyGroup[] {
  const groups = new Map<string, T[]>();
  for (const a of list) {
    const k = keyOf(a);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(a);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const correct = items.filter((a) => a.correct).length;
      const scores = items.map((a) => a.score).filter((s): s is number => s != null);
      return {
        key,
        label: labelOf(key, items[0]),
        attempts: items.length,
        correct,
        accuracy: correct / items.length,
        avgScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : null,
      };
    })
    .sort((a, b) => b.attempts - a.attempts || b.accuracy - a.accuracy);
}

export const calculateStrategyAccuracy = (list: readonly PracticeAttempt[]) => groupAccuracy(list, (a) => a.strategyId, (_k, a) => a.strategyName);
export const calculateInstrumentAccuracy = (list: readonly PracticeAttempt[]) => groupAccuracy(list, (a) => a.instrument);
export const calculateSessionAccuracy = (list: readonly PracticeAttempt[]) => groupAccuracy(list, (a) => a.session, (k) => (k === 'morning' ? 'Morning' : 'Afternoon'));
/** Accuracy by the decision the trader made (LONG / SHORT / WAIT). */
export const calculateDirectionAccuracy = (list: readonly PracticeAttempt[]) => groupAccuracy(list, (a) => a.decision, (k) => directionLabel(k));
/** Accuracy by what the correct answer was — e.g. how often valid shorts are recognised. */
export const calculateIdealDecisionAccuracy = (list: readonly PracticeAttempt[]) => groupAccuracy(list, (a) => a.idealDecision, (k) => directionLabel(k));
export const calculateRetestAccuracy = (list: readonly PracticeAttempt[]) =>
  groupAccuracy(list, (a) => (a.setupCharacteristics.retestNumber != null && a.setupCharacteristics.retestNumber > 0 ? String(a.setupCharacteristics.retestNumber) : null), (k) => retestLabel(Number(k)));

/** Consecutive correct decisions, most recent first. */
export function calculateStreak(list: readonly PracticeAttempt[]): number {
  const sorted = [...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  let n = 0;
  for (const a of sorted) {
    if (!a.correct) break;
    n++;
  }
  return n;
}

export interface SetupProfile extends AccuracyGroup {
  strategyName: string;
  retest: string;
  direction: string;
  instrument: string;
}

function setupGroups(list: readonly PracticeAttempt[]): SetupProfile[] {
  return groupAccuracy(list, (a) => `${a.strategyId}|${a.setupCharacteristics.retestNumber ?? '-'}|${a.direction}|${a.instrument}`).map((g) => {
    const [, retest, direction, instrument] = g.key.split('|');
    const sample = list.find((a) => `${a.strategyId}|${a.setupCharacteristics.retestNumber ?? '-'}|${a.direction}|${a.instrument}` === g.key)!;
    return { ...g, strategyName: sample.strategyName, retest: retest === '-' ? '' : retestLabel(Number(retest)), direction: directionLabel(direction), instrument, label: sample.strategyName };
  });
}

/** Most accurate specific setup (strategy × retest × direction × instrument) with enough attempts. */
export function calculateStrongestSetup(list: readonly PracticeAttempt[], minAttempts = MIN_GROUP_ATTEMPTS): SetupProfile | null {
  const g = setupGroups(list).filter((x) => x.attempts >= minAttempts);
  return g.sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts)[0] ?? null;
}

export function calculateWeakestSetup(list: readonly PracticeAttempt[], minAttempts = MIN_GROUP_ATTEMPTS): SetupProfile | null {
  const g = setupGroups(list).filter((x) => x.attempts >= minAttempts);
  const weakest = g.sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)[0] ?? null;
  const strongest = calculateStrongestSetup(list, minAttempts);
  return weakest && strongest && weakest.key === strongest.key ? null : weakest;
}

export interface PracticeInsight {
  id: string;
  title: string;
  body: string;
  comparison: { label: string; value: string; attempts: number }[];
  focus?: string;
}

/**
 * Rules-based "Personal Edge" observations. An insight appears only when both
 * sides have enough attempts AND the gap is meaningful. No certainty is implied.
 */
export function generatePracticeInsights(list: readonly PracticeAttempt[]): PracticeInsight[] {
  if (list.length < MIN_INSIGHT_ATTEMPTS) return [];
  const out: PracticeInsight[] = [];
  const minEach = MIN_GROUP_ATTEMPTS;

  const compare = (id: string, groups: AccuracyGroup[], make: (hi: AccuracyGroup, lo: AccuracyGroup) => Omit<PracticeInsight, 'id' | 'comparison'>) => {
    const eligible = groups.filter((g) => g.attempts >= minEach).sort((a, b) => b.accuracy - a.accuracy);
    if (eligible.length < 2) return;
    const hi = eligible[0];
    const lo = eligible[eligible.length - 1];
    if (hi.accuracy - lo.accuracy < MIN_INSIGHT_GAP) return;
    out.push({ id, ...make(hi, lo), comparison: [hi, lo].map((g) => ({ label: g.label, value: pct(g.accuracy), attempts: g.attempts })) });
  };

  // Retest number within each strategy (e.g. first vs third ORB retest).
  const byStrategy = new Map<string, PracticeAttempt[]>();
  for (const a of list) byStrategy.set(a.strategyId, [...(byStrategy.get(a.strategyId) ?? []), a]);
  for (const [sid, items] of byStrategy) {
    const name = items[0].strategyName;
    compare(`retest-${sid}`, calculateRetestAccuracy(items), (hi, lo) => ({
      title: `${name}: ${hi.label.toLowerCase()} vs ${lo.label.toLowerCase()}`,
      body: `Your ${hi.label.toLowerCase()} ${name} decisions are currently more accurate than your ${lo.label.toLowerCase()} decisions.`,
      focus: `${lo.label} recognition`,
    }));
    compare(`dir-${sid}`, groupAccuracy(items, (a) => a.direction, (k) => directionLabel(k)), (hi, lo) => ({
      title: `${name}: ${hi.label} vs ${lo.label}`,
      body: `You perform better on ${hi.label.toUpperCase()} ${name} scenarios than ${lo.label.toUpperCase()} ones.`,
      focus: `${lo.label} ${name} setups`,
    }));
  }

  compare('ideal', calculateIdealDecisionAccuracy(list), (hi, lo) => ({
    title: lo.key === 'wait' ? 'Recognising no-trade situations' : `Recognising ${lo.label.toLowerCase()} setups`,
    body:
      lo.key === 'wait'
        ? 'You identify valid setups more reliably than situations where the rules say WAIT. Over-trading invalid setups is the most common gap.'
        : `You recognise ${hi.label.toLowerCase()} situations more reliably than ${lo.label.toLowerCase()} setups.`,
    focus: lo.key === 'wait' ? 'Spotting when the rules are NOT met' : `${lo.label} setups`,
  }));

  compare('session', calculateSessionAccuracy(list), (hi, lo) => ({
    title: `${hi.label} vs ${lo.label} sessions`,
    body: `Your decisions in ${hi.label.toLowerCase()} scenarios are more accurate than in ${lo.label.toLowerCase()} scenarios.`,
    focus: `${lo.label} scenarios`,
  }));

  return out.slice(0, 4);
}

export interface PracticeSummary {
  attempts: number;
  accuracy: number | null;
  avgScore: number | null;
  streak: number;
  bestStrategy: AccuracyGroup | null;
  weakestStrategy: AccuracyGroup | null;
}

/** Headline numbers for the Practice home. Best/weakest need at least 3 attempts per strategy. */
export function summarizePractice(list: readonly PracticeAttempt[], minPerStrategy = 3): PracticeSummary {
  const strategies = calculateStrategyAccuracy(list).filter((g) => g.attempts >= minPerStrategy);
  const sorted = [...strategies].sort((a, b) => b.accuracy - a.accuracy || b.attempts - a.attempts);
  const best = sorted[0] ?? null;
  const worst = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  return {
    attempts: list.length,
    accuracy: accuracyOf(list),
    avgScore: calculateAverageScore(list),
    streak: calculateStreak(list),
    bestStrategy: best,
    weakestStrategy: worst && best && worst.key !== best.key ? worst : null,
  };
}
