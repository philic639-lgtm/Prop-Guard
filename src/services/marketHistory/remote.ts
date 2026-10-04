import { supabase } from '@/services/supabase/client';
import type { HistoricalScenario, ScenarioBar } from '@/types/marketHistory';

import { setVerifiedScenarios } from './historical';

/**
 * Load VERIFIED historical scenarios generated server-side. Read-only for
 * users (RLS). Pre- and post-decision candles live in separate rows of
 * practice_scenario_candles. Safe to call when Supabase is not configured.
 */
export async function loadVerifiedScenarios(limit = 300): Promise<number> {
  if (!supabase) return 0;
  const { data: rows, error } = await supabase
    .from('practice_scenarios')
    .select('*')
    .eq('historical', true)
    .eq('verified', true)
    .eq('is_active', true)
    .order('decision_timestamp', { ascending: false })
    .limit(limit);
  if (error || !rows?.length) return 0;
  const ids = rows.map((r) => r.id as string);
  const { data: candles, error: cErr } = await supabase.from('practice_scenario_candles').select('scenario_id, phase, bars').in('scenario_id', ids);
  if (cErr) return 0;
  const byId = new Map<string, { pre?: ScenarioBar[]; post?: ScenarioBar[] }>();
  for (const c of candles ?? []) {
    const e = byId.get(c.scenario_id as string) ?? {};
    if (c.phase === 'pre') e.pre = c.bars as ScenarioBar[];
    else e.post = c.bars as ScenarioBar[];
    byId.set(c.scenario_id as string, e);
  }
  const list: HistoricalScenario[] = [];
  for (const r of rows) {
    const d = r.definition as Partial<HistoricalScenario> | null;
    const bars = byId.get(r.id as string);
    if (!d || !bars?.pre?.length || !bars.post) continue;
    list.push({ ...(d as HistoricalScenario), id: r.id as string, verified: true, historical: true, preBars: bars.pre, postBars: bars.post });
  }
  setVerifiedScenarios(list);
  return list.length;
}
