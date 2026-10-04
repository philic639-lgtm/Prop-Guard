import { matchTemplates } from '@/lib/engines/strategyLibraryEngine';

import type { StrategyFinderAnswers, StrategyRecommendation } from './types';

/**
 * Deterministic structural matching between a trader's answers and the
 * curated library. It explains FIT, never expected profitability.
 */
export function matchStrategies(a: StrategyFinderAnswers, count = 5): StrategyRecommendation[] {
  return matchTemplates(a, count);
}
