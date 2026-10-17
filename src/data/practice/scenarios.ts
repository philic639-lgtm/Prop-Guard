import type { PracticeDifficulty, PracticeScenario, PracticeSession } from '@/types/practice';

import { buildScenario, PRACTICE_INSTRUMENTS, type ScenarioSpec } from './scenarioFactory';

/**
 * Seed catalog of EDUCATIONAL SAMPLE scenarios (market-history layer).
 * Each pattern appears long and short on two different instruments so every
 * supported contract has scenarios. Replace with verified historical data via
 * the ScenarioProvider in src/services/marketHistory.
 */
const PLAN: { archetype: ScenarioSpec['archetype']; difficulty: PracticeDifficulty; sessions: PracticeSession[]; great?: boolean }[] = [
  { archetype: 'orb_first_retest', difficulty: 'Beginner', sessions: ['morning'], great: true },
  { archetype: 'orb_third_retest', difficulty: 'Advanced', sessions: ['morning'] },
  { archetype: 'orb_failed', difficulty: 'Intermediate', sessions: ['morning'] },
  { archetype: 'trend_pullback', difficulty: 'Beginner', sessions: ['morning', 'afternoon'], great: true },
  { archetype: 'trend_pullback_fail', difficulty: 'Intermediate', sessions: ['afternoon', 'morning'] },
  { archetype: 'vwap_reclaim', difficulty: 'Intermediate', sessions: ['morning', 'afternoon'], great: true },
  { archetype: 'vwap_reclaim_fail', difficulty: 'Intermediate', sessions: ['afternoon', 'morning'] },
  { archetype: 'sweep_reversal', difficulty: 'Advanced', sessions: ['morning'], great: true },
  { archetype: 'sweep_accepted', difficulty: 'Advanced', sessions: ['morning'] },
  { archetype: 'breakout_retest', difficulty: 'Beginner', sessions: ['morning', 'afternoon'], great: true },
  { archetype: 'breakout_third_retest', difficulty: 'Advanced', sessions: ['afternoon', 'morning'] },
  { archetype: 'pd_level_breakout', difficulty: 'Beginner', sessions: ['morning'], great: true },
  { archetype: 'flag_break', difficulty: 'Intermediate', sessions: ['morning', 'afternoon'], great: true },
  // Rule-valid setups whose stop was hit — so practice never implies valid = guaranteed.
  { archetype: 'orb_first_retest_stopped', difficulty: 'Intermediate', sessions: ['morning'] },
  { archetype: 'trend_pullback_stopped', difficulty: 'Intermediate', sessions: ['afternoon', 'morning'] },
];

function specs(): ScenarioSpec[] {
  const out: ScenarioSpec[] = [];
  let n = 0;
  PLAN.forEach((p, pi) => {
    (['long', 'short'] as const).forEach((direction, di) => {
      for (let v = 0; v < 2; v++) {
        const instrument = PRACTICE_INSTRUMENTS[(pi * 4 + di * 2 + v * 5) % PRACTICE_INSTRUMENTS.length];
        out.push({
          id: `sample-${p.archetype.replace(/_/g, '-')}-${direction}-${v + 1}`,
          archetype: p.archetype,
          instrument,
          direction,
          session: p.sessions[(di + v) % p.sessions.length],
          day: ++n,
          difficulty: p.difficulty,
          // One clean, textbook example per pattern and direction is a "Great Setup".
          great: p.great && v === 0,
          shift: (pi * 7 + v * 13) % 23,
        });
      }
    });
  });
  return out;
}

export const SAMPLE_SCENARIOS: PracticeScenario[] = specs().map(buildScenario);
