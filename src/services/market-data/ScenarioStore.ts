import type { SupabaseClient } from '@supabase/supabase-js';

import type { HistoricalScenario } from '@/types/marketHistory';

/** Persistent store for generated scenarios (market-history layer). */
export interface ScenarioStore {
  /** Insert or update scenarios; returns how many were written. */
  saveScenarios(list: readonly HistoricalScenario[]): Promise<number>;
  existingIds(ids: readonly string[]): Promise<Set<string>>;
}

export class InMemoryScenarioStore implements ScenarioStore {
  readonly scenarios = new Map<string, HistoricalScenario>();
  async saveScenarios(list: readonly HistoricalScenario[]) {
    for (const s of list) this.scenarios.set(s.id, s);
    return list.length;
  }
  async existingIds(ids: readonly string[]) {
    return new Set(ids.filter((id) => this.scenarios.has(id)));
  }
}

/** Row shape for practice_scenarios (definition holds checks, levels, features, VWAP, outcome). */
export function scenarioToRow(s: HistoricalScenario) {
  const { preBars: _pre, postBars: _post, ...definition } = s;
  const minutes = s.features.timeOfDayMinutes;
  return {
    id: s.id,
    instrument: s.instrument,
    strategy_id: s.strategyId,
    strategy_name: s.strategyName,
    strategy_version: s.strategyVersion,
    timeframe: s.timeframe,
    session_date: s.etDate,
    session: minutes < 12 * 60 ? 'morning' : 'afternoon',
    market_session: s.marketSession,
    difficulty: !s.valid ? 'Advanced' : s.features.breakoutStrength === 'strong' ? 'Beginner' : 'Intermediate',
    direction: s.direction,
    quality: s.valid ? 'standard' : 'trap',
    source_kind: s.historical ? 'historical' : 'simulated',
    historical: s.historical,
    verified: s.verified,
    provider: s.provider,
    data_provider: s.provider,
    scenario_start: s.scenarioStart,
    decision_timestamp: s.decisionTimestamp,
    scenario_end: s.scenarioEnd,
    valid_setup: s.valid,
    entry_price: s.entry,
    stop_price: s.stop,
    target_price: s.target,
    outcome: s.outcome.status,
    outcome_ambiguous: s.outcome.ambiguous,
    max_favorable_excursion: s.outcome.mfeR,
    max_adverse_excursion: s.outcome.maeR,
    rr_achieved: s.outcome.rrAchieved,
    features: s.features,
    definition,
  };
}

export class SupabaseScenarioStore implements ScenarioStore {
  constructor(private readonly db: SupabaseClient) {}

  async saveScenarios(list: readonly HistoricalScenario[]) {
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const { error } = await this.db.from('practice_scenarios').upsert(chunk.map(scenarioToRow), { onConflict: 'id' });
      if (error) throw new Error(`practice_scenarios upsert failed: ${error.message}`);
      const candles = chunk.flatMap((s) => [
        { scenario_id: s.id, phase: 'pre', bars: s.preBars },
        { scenario_id: s.id, phase: 'post', bars: s.postBars },
      ]);
      const { error: cErr } = await this.db.from('practice_scenario_candles').upsert(candles, { onConflict: 'scenario_id,phase' });
      if (cErr) throw new Error(`practice_scenario_candles upsert failed: ${cErr.message}`);
    }
    return list.length;
  }

  async existingIds(ids: readonly string[]) {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await this.db.from('practice_scenarios').select('id').in('id', ids.slice(i, i + 500));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) out.add(r.id as string);
    }
    return out;
  }
}
