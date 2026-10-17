import { getTemplate } from '@/data/strategyLibrary';

import { matchStrategies } from '../ai/strategyMatcher';
import type { StrategyFinderAnswers } from '../ai/types';

const base: StrategyFinderAnswers = {
  instruments: ['ES'],
  session: 'ny_open',
  style: 'breakout',
  patience: 'quality',
  holdTime: '5-20',
  environment: 'trending',
  riskReward: '2',
  experience: 'Beginner',
};

describe('strategy matcher (curated library only)', () => {
  it('ranks the 15M ORB Retest first for a NY-open breakout trader on ES', () => {
    const [top] = matchStrategies({ ...base, patience: 'selective' });
    expect(top.templateId).toBe('orb-15');
    expect(top.reasons).toEqual(expect.arrayContaining(['You trade ES', 'You trade the NY Open', 'You prefer breakout/retest entries']));
  });

  it('returns the top 5 library templates, highest fit first', () => {
    const recs = matchStrategies(base);
    expect(recs).toHaveLength(5);
    for (const r of recs) expect(getTemplate(r.templateId)).toBeDefined();
    const scores = recs.map((r) => r.fitScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('prefers pullbacks when asked', () => {
    const recs = matchStrategies({ ...base, style: 'pullback', session: 'ny_morning' });
    expect(getTemplate(recs[0].templateId)?.style).toBe('pullback');
  });

  it('matches non-index markets to templates that support them', () => {
    const recs = matchStrategies({ ...base, instruments: ['CL'], session: 'london', style: 'trend' });
    expect(getTemplate(recs[0].templateId)?.instruments).toContain('CL');
  });

  it('notes when a mini contract stop is large for the daily budget', () => {
    const recs = matchStrategies({ ...base, dailyRisk: 300 });
    expect(recs.some((r) => r.cautions.some((c) => c.includes('micro')))).toBe(true);
  });

  it('never claims profitability', () => {
    const recs = matchStrategies({ ...base, style: 'unsure', environment: 'any', riskReward: 'unsure' });
    for (const r of recs) for (const text of [...r.reasons, ...r.cautions]) expect(text.toLowerCase()).not.toMatch(/profit|guarantee|win rate|proven/);
  });
});
