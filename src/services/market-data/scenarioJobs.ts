import { generateScenariosFromBars } from '@/lib/engines/historicalScenarioGenerator';
import { hasEvaluator } from '@/lib/engines/strategyEvaluators';
import type { HistoricalScenario } from '@/types/marketHistory';

import type { HistoricalBarStore } from './HistoricalBarStore';
import { aggregateBars } from './normalize';
import { toIso, type MarketDataProvider, type Timeframe } from './MarketDataProvider';
import type { ScenarioStore } from './ScenarioStore';

export interface GenerateJobRequest {
  strategyId: string;
  instrument: string;
  startDate: string | Date;
  endDate: string | Date;
  /** Chart timeframe for the scenarios (default 5m). Bars are aggregated from stored 1m data. */
  timeframe?: Timeframe;
  /** Timeframe of the stored source bars (default 1m). */
  sourceTimeframe?: Timeframe;
}

export interface GenerateJobDeps {
  barStore: HistoricalBarStore;
  scenarioStore: ScenarioStore;
  /** Provider whose stored bars to use — determines verified / simulated tagging. */
  provider: Pick<MarketDataProvider, 'id' | 'verified'>;
  log?: (msg: string) => void;
}

export interface GenerateJobResult {
  bars: number;
  scenarios: number;
  valid: number;
  wait: number;
  ambiguous: number;
  newScenarios: number;
  sample: HistoricalScenario[];
}

/**
 * Generate scenarios from STORED bars only (no provider calls). Run
 * ingestHistoricalData first; this job never downloads data.
 */
export async function generateHistoricalScenarios(req: GenerateJobRequest, deps: GenerateJobDeps): Promise<GenerateJobResult> {
  if (!hasEvaluator(req.strategyId)) throw new Error(`No historical evaluator for "${req.strategyId}" yet.`);
  const log = deps.log ?? (() => undefined);
  const tf = req.timeframe ?? '5m';
  const src = req.sourceTimeframe ?? '1m';
  // Include a week before the start so previous-day levels exist for the first session.
  const start = new Date(Date.parse(toIso(req.startDate)) - 7 * 86_400_000).toISOString();
  const stored = await deps.barStore.getBars({ instrument: req.instrument, timeframe: src, start, end: toIso(req.endDate), provider: deps.provider.id });
  const bars = src === tf ? stored : aggregateBars(stored, tf);
  log(`• ${stored.length} stored ${src} bars → ${bars.length} ${tf} bars`);
  const all = generateScenariosFromBars({
    instrument: req.instrument,
    timeframe: tf,
    strategyId: req.strategyId,
    provider: deps.provider.id,
    verified: deps.provider.verified,
    historical: deps.provider.verified,
    bars,
  }).filter((s) => s.decisionTimestamp >= toIso(req.startDate));
  const existing = await deps.scenarioStore.existingIds(all.map((s) => s.id));
  await deps.scenarioStore.saveScenarios(all);
  const res: GenerateJobResult = {
    bars: bars.length,
    scenarios: all.length,
    valid: all.filter((s) => s.valid).length,
    wait: all.filter((s) => !s.valid).length,
    ambiguous: all.filter((s) => s.outcome.ambiguous).length,
    newScenarios: all.length - existing.size,
    sample: all.slice(0, 3),
  };
  log(`✓ ${res.scenarios} scenarios (${res.valid} valid, ${res.wait} wait, ${res.ambiguous} ambiguous outcomes) — ${res.newScenarios} new.`);
  return res;
}
