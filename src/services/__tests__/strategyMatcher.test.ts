import { getTemplate } from '@/data/strategyLibrary';

import { matchStrategies } from '../ai/strategyMatcher';
import type { StrategyFinderAnswers } from '../ai/types';

const base: StrategyFinderAnswers = {
  market: 'MES',
  tradesPerDay: '1',
  session: 'open',
  style: 'intraday',
  stopSize: 'medium',
  target: '2R',
  preference: 'breakout',
  accountSize: 25000,
  dailyRisk: 400,
};

describe('strategy matcher', () => {
  it('recommends an opening-range breakout for a 1-trade breakout trader at the open', () => {
    const [top] = matchStrategies(base);
    expect(top.templateId).toBe('orb-15');
    expect(top.reasons.length).toBeGreaterThan(0);
  });

  it('prefers pullbacks when asked', () => {
    const recs = matchStrategies({ ...base, preference: 'pullback', session: 'any', tradesPerDay: '2-3' });
    expect(getTemplate(recs[0].templateId)?.style).toBe('pullback');
    expect(getTemplate(recs[1].templateId)?.style).toBe('pullback');
  });

  it('warns when one mini contract risks too much of the daily budget', () => {
    const recs = matchStrategies({ ...base, market: 'ES', dailyRisk: 300 });
    expect(recs.some((r) => r.reasons.some((x) => x.includes('Consider micros')))).toBe(true);
  });

  it('never returns more than three results and never claims profitability', () => {
    const recs = matchStrategies({ ...base, preference: 'unsure' });
    expect(recs.length).toBeLessThanOrEqual(3);
    for (const r of recs) for (const reason of r.reasons) expect(reason.toLowerCase()).not.toMatch(/profit|guarantee|win rate/);
  });
});
