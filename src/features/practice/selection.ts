import { create } from 'zustand';

import { chooseSmartScenario } from '@/lib/engines/adaptivePracticeEngine';
import { scenarioProvider, type ScenarioFilters } from '@/services/marketHistory';
import type { PracticeAttempt, PracticeDifficulty, PracticeScenario, PracticeSession } from '@/types/practice';

export type PracticeMode = 'standard' | 'smart' | 'great';

export interface PracticeSetup {
  instrument: string | null;
  strategyId: string | null;
  difficulty: PracticeDifficulty | null;
  direction: 'long' | 'short' | null;
  session: PracticeSession | null;
  /** samples — educational patterns; historical — scenarios generated from bars (verified, or SIMULATED in development). */
  source: 'samples' | 'historical';
}

interface PracticeSetupState {
  setup: PracticeSetup;
  mode: PracticeMode;
  setSetup: (patch: Partial<PracticeSetup>) => void;
  setMode: (mode: PracticeMode) => void;
}

/** Current trainer selections (kept in memory so "Next scenario" reuses them). */
export const usePracticeSetup = create<PracticeSetupState>((set) => ({
  setup: { instrument: null, strategyId: null, difficulty: null, direction: null, session: null, source: 'samples' },
  mode: 'standard',
  setSetup: (patch) => set((s) => ({ setup: { ...s.setup, ...patch } })),
  setMode: (mode) => set({ mode }),
}));

export const filtersFor = (s: PracticeSetup): ScenarioFilters => ({
  instrument: s.instrument,
  strategyId: s.strategyId,
  difficulty: s.difficulty,
  direction: s.direction,
  session: s.session,
  source: s.source,
});

export interface ScenarioPick {
  scenario: PracticeScenario;
  reason?: string;
}

/** Prefer scenarios the trader has seen least (and not the one just played). */
function leastPracticed(list: PracticeScenario[], attempts: readonly PracticeAttempt[], excludeId?: string): PracticeScenario | null {
  const pool = list.length > 1 && excludeId ? list.filter((s) => s.id !== excludeId) : list;
  if (!pool.length) return null;
  const count = (id: string) => attempts.filter((a) => a.scenarioId === id).length;
  const min = Math.min(...pool.map((s) => count(s.id)));
  const fresh = pool.filter((s) => count(s.id) === min);
  return fresh[Math.floor(Math.random() * fresh.length)];
}

/** Choose the next scenario for a mode. Call from event handlers (uses randomness). */
export function pickScenario(mode: PracticeMode, setup: PracticeSetup, attempts: readonly PracticeAttempt[], excludeId?: string): ScenarioPick | null {
  if (mode === 'great') {
    // Great setups are curated educational examples (historical scenarios are never hand-labelled "great").
    const narrowed = scenarioProvider.list({ greatOnly: true, instrument: setup.instrument, strategyId: setup.strategyId });
    const s = leastPracticed(narrowed.length ? narrowed : scenarioProvider.list({ greatOnly: true }), attempts, excludeId);
    return s ? { scenario: s, reason: 'A clean, textbook example chosen to show what a strong setup looks like.' } : null;
  }
  if (mode === 'smart') {
    const scoped = scenarioProvider.list({ instrument: setup.instrument, source: setup.source });
    const pool = (scoped.length ? scoped : scenarioProvider.list({ source: setup.source })).filter((s) => s.id !== excludeId);
    const pick = chooseSmartScenario(pool, attempts, Math.random(), Math.random());
    return pick ? { scenario: pick.scenario, reason: pick.reason } : null;
  }
  const s = leastPracticed(scenarioProvider.list(filtersFor(setup)), attempts, excludeId);
  return s ? { scenario: s } : null;
}
