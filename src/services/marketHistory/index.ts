import { SAMPLE_SCENARIOS } from '@/data/practice/scenarios';
import type { PracticeDifficulty, PracticeScenario, PracticeSession } from '@/types/practice';

/**
 * Market-history layer: where practice scenarios come from.
 *
 * Today only the educational sample provider exists. A verified provider
 * (historical futures bars from a licensed data vendor, labelled with
 * `source.kind = 'historical'` and `verified = true`) can implement the same
 * interface without touching the trainer UI, scoring or analytics.
 */
export interface ScenarioFilters {
  instrument?: string | null;
  strategyId?: string | null;
  difficulty?: PracticeDifficulty | null;
  direction?: 'long' | 'short' | null;
  session?: PracticeSession | null;
  greatOnly?: boolean;
}

export interface ScenarioProvider {
  readonly id: string;
  /** True when scenarios come from verified historical market data. */
  readonly verified: boolean;
  list(filters?: ScenarioFilters): PracticeScenario[];
  get(id: string): PracticeScenario | undefined;
}

export function filterScenarios(list: readonly PracticeScenario[], f: ScenarioFilters = {}): PracticeScenario[] {
  return list.filter(
    (s) =>
      (!f.instrument || s.instrument === f.instrument) &&
      (!f.strategyId || s.strategyId === f.strategyId) &&
      (!f.difficulty || s.difficulty === f.difficulty) &&
      (!f.direction || s.direction === f.direction) &&
      (!f.session || s.session === f.session) &&
      (!f.greatOnly || s.quality === 'great'),
  );
}

const BY_ID = new Map(SAMPLE_SCENARIOS.map((s) => [s.id, s]));

export const sampleScenarioProvider: ScenarioProvider = {
  id: 'educational-samples',
  verified: false,
  list: (filters) => filterScenarios(SAMPLE_SCENARIOS, filters),
  get: (id) => BY_ID.get(id),
};

/** The active provider. Swap here when verified historical data is connected. */
export const scenarioProvider: ScenarioProvider = sampleScenarioProvider;
