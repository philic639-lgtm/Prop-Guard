import { SAMPLE_SCENARIOS } from '@/data/practice/scenarios';

import { getVerifiedPractice, simulatedScenarios } from './historical';
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
  /**
   * samples — hand-designed educational patterns (default);
   * historical — scenarios generated from bars (verified history, or SIMULATED bars in development).
   */
  source?: 'samples' | 'historical';
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
      (!f.greatOnly || s.quality === 'great') &&
      (f.source === 'historical' ? s.source.kind !== 'educational_sample' : f.source === 'samples' ? s.source.kind === 'educational_sample' : true),
  );
}

const BY_ID = new Map(SAMPLE_SCENARIOS.map((s) => [s.id, s]));

export const sampleScenarioProvider: ScenarioProvider = {
  id: 'educational-samples',
  verified: false,
  list: (filters) => filterScenarios(SAMPLE_SCENARIOS, { ...filters, source: undefined }),
  get: (id) => BY_ID.get(id),
};

/**
 * Historical scenarios: verified ones loaded from Supabase when available,
 * plus SIMULATED ones generated on-device from the mock provider (until a
 * verified data source is connected, these are the only historical scenarios).
 */
export const historicalScenarioProvider: ScenarioProvider = {
  id: 'historical',
  verified: false,
  list: (filters) => {
    const verified = getVerifiedPractice();
    return filterScenarios([...verified, ...simulatedScenarios().practice], { ...filters, source: undefined });
  },
  get: (id) => getVerifiedPractice().find((s) => s.id === id) ?? (id.startsWith('hs-mock-') ? simulatedScenarios().practice.find((s) => s.id === id) : undefined),
};

/** The catalog the trainer uses: samples by default, historical on request. */
export const scenarioProvider: ScenarioProvider = {
  id: 'catalog',
  verified: false,
  list: (filters = {}) => (filters.source === 'historical' ? historicalScenarioProvider.list(filters) : sampleScenarioProvider.list(filters)),
  get: (id) => sampleScenarioProvider.get(id) ?? historicalScenarioProvider.get(id),
};
