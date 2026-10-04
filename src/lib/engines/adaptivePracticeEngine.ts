import type { PracticeAttempt, PracticeScenario } from '@/types/practice';

import { accuracyOf } from './practiceAnalyticsEngine';

/**
 * Smart Practice: choose the next scenario from the trader's weaknesses while
 * keeping sessions balanced (~60% weak areas, 25% average, 15% strengths).
 * An "area" is strategy × pattern direction.
 */
export const SMART_MIX = { weak: 0.6, average: 0.25, strong: 0.15 } as const;
export const MIN_AREA_ATTEMPTS = 3;
export const MIN_SMART_HISTORY = 5;

export type AreaBucket = 'weak' | 'average' | 'strong';

export interface AreaStat {
  key: string;
  strategyName: string;
  direction: 'long' | 'short';
  attempts: number;
  accuracy: number | null;
  bucket: AreaBucket;
}

export interface SmartPick {
  scenario: PracticeScenario;
  bucket: AreaBucket | 'explore';
  reason: string;
}

export const areaKey = (x: { strategyId: string; direction: 'long' | 'short' }) => `${x.strategyId}|${x.direction}`;

export function areaStats(scenarios: readonly PracticeScenario[], attempts: readonly PracticeAttempt[]): AreaStat[] {
  const areas = new Map<string, { strategyName: string; direction: 'long' | 'short' }>();
  for (const s of scenarios) areas.set(areaKey(s), { strategyName: s.strategyName, direction: s.direction });
  return [...areas.entries()].map(([key, a]) => {
    const list = attempts.filter((x) => areaKey(x) === key);
    const acc = list.length >= MIN_AREA_ATTEMPTS ? accuracyOf(list) : null;
    const bucket: AreaBucket = acc == null ? 'average' : acc < 0.6 ? 'weak' : acc >= 0.8 ? 'strong' : 'average';
    return { key, ...a, attempts: list.length, accuracy: acc, bucket };
  });
}

function bucketFor(roll: number): AreaBucket {
  if (roll < SMART_MIX.weak) return 'weak';
  if (roll < SMART_MIX.weak + SMART_MIX.average) return 'average';
  return 'strong';
}

const dirWord = (d: 'long' | 'short') => (d === 'long' ? 'long' : 'short');

/**
 * Pick a scenario. `roll` and `pickRoll` are random numbers in [0,1) supplied by
 * the caller so the engine stays deterministic and testable.
 */
export function chooseSmartScenario(
  scenarios: readonly PracticeScenario[],
  attempts: readonly PracticeAttempt[],
  roll: number,
  pickRoll: number,
): SmartPick | null {
  if (!scenarios.length) return null;
  const recent = new Set([...attempts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8).map((a) => a.scenarioId));
  const fresh = (list: readonly PracticeScenario[]) => {
    const unseen = list.filter((s) => !recent.has(s.id));
    return unseen.length ? unseen : list;
  };
  const pick = (list: readonly PracticeScenario[]) => list[Math.min(list.length - 1, Math.floor(pickRoll * list.length))];

  if (attempts.length < MIN_SMART_HISTORY) {
    const s = pick(fresh(scenarios));
    return { scenario: s, bucket: 'explore', reason: `Not enough practice history yet (${attempts.length}/${MIN_SMART_HISTORY}) — Prop Guard picked a varied scenario to learn your strengths and weaknesses.` };
  }

  const stats = areaStats(scenarios, attempts);
  const byBucket = (b: AreaBucket) => new Set(stats.filter((s) => s.bucket === b).map((s) => s.key));
  const order: AreaBucket[] = [bucketFor(roll), 'weak', 'average', 'strong'];
  for (const b of order) {
    const keys = byBucket(b);
    const pool = scenarios.filter((s) => keys.has(areaKey(s)));
    if (!pool.length) continue;
    const scenario = pick(fresh(pool));
    const st = stats.find((x) => x.key === areaKey(scenario))!;
    const accText = st.accuracy != null ? ` (${Math.round(st.accuracy * 100)}% over ${st.attempts} attempts)` : '';
    const reason =
      b === 'weak'
        ? `You've been less accurate identifying ${dirWord(st.direction)} ${st.strategyName} setups${accText}.`
        : b === 'strong'
          ? `Reinforcing a strength: ${dirWord(st.direction)} ${st.strategyName}${accText}.`
          : st.accuracy == null
            ? `Building a baseline on ${dirWord(st.direction)} ${st.strategyName} — you haven't practised it much yet.`
            : `Keeping your ${dirWord(st.direction)} ${st.strategyName} recognition sharp${accText}.`;
    return { scenario, bucket: b, reason };
  }
  return null;
}
