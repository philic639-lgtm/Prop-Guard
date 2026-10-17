import { findSimilarHistoricalSetups, similarityHighlights, type HistoricalSimilarityStats } from '@/lib/engines/historicalSimilarityEngine';
import type { TrainerHistoryContext } from '@/lib/engines/practiceScoringEngine';
import { getVerifiedHistorical } from '@/services/marketHistory/historical';
import type { PracticeScenario, PracticeTradeInput } from '@/types/practice';

/**
 * Similar VERIFIED historical setups for a scenario. Simulated and sample
 * scenarios never feed these statistics — with no verified data the result is
 * a "limited sample" message and no numbers.
 */
export function historicalStatsFor(s: PracticeScenario): HistoricalSimilarityStats | null {
  if (!s.historical) return null;
  return findSimilarHistoricalSetups({ strategyId: s.strategyId, instrument: s.instrument, direction: s.direction, features: s.historical.features }, getVerifiedHistorical(), { excludeId: s.id });
}

export const trainerContext = (stats: HistoricalSimilarityStats | null): TrainerHistoryContext | null =>
  stats ? { limited: stats.limited, sampleSize: stats.sampleSize, typicalWinnerMAE: stats.typicalWinnerMAE, medianMFE: stats.medianMFE } : null;

/** The user's stop distance in units of the strategy's planned risk (compared with typical pullbacks). */
export function userStopInPlanR(s: PracticeScenario, input: PracticeTradeInput): number | null {
  const it = s.idealTrade;
  if (!it || input.decision === 'wait' || input.entry == null || input.stop == null) return null;
  const planRisk = Math.abs(it.entry - it.stop);
  return planRisk > 0 ? Math.round((Math.abs(input.entry - input.stop) / planRisk) * 100) / 100 : null;
}

export const historicalLines = (stats: HistoricalSimilarityStats | null, s: PracticeScenario, input: PracticeTradeInput): string[] =>
  stats ? similarityHighlights(stats, userStopInPlanR(s, input)) : [];
