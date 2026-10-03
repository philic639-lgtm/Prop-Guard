import { STRATEGY_LIBRARY, type LibraryTemplate } from '@/data/strategyLibrary';
import { getInstrument } from '@/lib/engines/instrumentEngine';

import type { StrategyFinderAnswers, StrategyRecommendation } from './types';

/**
 * Deterministic structural matching between a trader's stated preferences
 * and library templates. It explains FIT, never expected profitability.
 */
const STOP_RANGES: Record<StrategyFinderAnswers['stopSize'], [number, number]> = {
  tight: [2, 5],
  medium: [4, 8],
  wide: [7, 12],
};

function overlap(a: [number, number], b: [number, number]) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

export function scoreTemplate(t: LibraryTemplate, a: StrategyFinderAnswers): StrategyRecommendation {
  let score = 40;
  const reasons: string[] = [];

  const wantTrades = a.tradesPerDay === '1' ? 1 : a.tradesPerDay === '2-3' ? 2 : 4;
  if (t.tradesPerDay <= wantTrades) {
    score += 12;
    reasons.push(`Produces about ${t.tradesPerDay} trade${t.tradesPerDay > 1 ? 's' : ''} per day — within your ${a.tradesPerDay} preference.`);
  } else {
    score -= 8;
  }

  if (a.session === 'any' || t.timing === 'any' || t.timing === a.session || (a.session === 'morning' && t.timing === 'open')) {
    score += 10;
    reasons.push(`Typically forms during the ${t.session} session.`);
  } else {
    score -= 10;
  }

  if (a.preference !== 'unsure') {
    if (t.style === a.preference) {
      score += 18;
      reasons.push(`Matches your preference for ${a.preference} setups.`);
    } else {
      score -= 6;
    }
  }

  const stopFit = overlap(STOP_RANGES[a.stopSize], t.stopRange);
  if (stopFit > 0) {
    score += 10;
    reasons.push(`Typical stop of ${t.stopRange[0]}–${t.stopRange[1]} points fits your ${a.stopSize} stop preference.`);
  } else {
    score -= 8;
  }

  const targetR = Number(a.target.replace('R', ''));
  if (targetR >= 2 && t.defaults.minRR >= 2) {
    score += 6;
    reasons.push(`Built around a ${t.defaults.minRR}R minimum target.`);
  } else if (targetR < 2 && t.defaults.minRR < 2) {
    score += 6;
    reasons.push(`Uses ${t.defaults.minRR}R targets, close to your ${a.target} preference.`);
  }

  if (t.needsConfirmation) {
    score += 4;
    reasons.push('Requires confirmation before entry, which supports patience.');
  }

  if (a.style === 'scalp' && t.stopRange[1] <= 7) score += 4;
  if (t.complexity === 'Beginner') score += 3;
  if (t.complexity === 'Advanced') score -= 4;

  // Risk sanity: can the typical stop be taken within the trader's per-trade budget on 1 contract?
  const perTradeBudget = a.dailyRisk / 2;
  const minContractRisk = t.stopRange[0] * getInstrument(a.market).pointValue;
  if (minContractRisk > perTradeBudget) {
    score -= 15;
    reasons.push(
      `Note: a ${t.stopRange[0]}-point stop on 1 ${a.market} risks $${minContractRisk}, more than half your daily risk. Consider micros.`,
    );
  }

  return { templateId: t.id, fitScore: Math.max(0, Math.min(99, score)), reasons: reasons.slice(0, 6) };
}

export function matchStrategies(a: StrategyFinderAnswers, count = 3): StrategyRecommendation[] {
  return STRATEGY_LIBRARY.map((t) => scoreTemplate(t, a))
    .sort((x, y) => y.fitScore - x.fitScore)
    .slice(0, count);
}
