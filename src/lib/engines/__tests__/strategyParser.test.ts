import { makeStrategy } from '@/test/fixtures';

import { parseStrategyText, STRATEGY_EXAMPLE, strategyFromParsed, strategyRules } from '../strategyParser';

describe('parseStrategyText', () => {
  const p = parseStrategyText(STRATEGY_EXAMPLE);

  it('extracts measurable rules from the example description', () => {
    expect(p.name).toBe('15M ORB Retest');
    expect(p.instrument).toBe('ES');
    expect(p.entryWindowStart).toBe('09:45');
    expect(p.stopMaxPoints).toBe(5);
    expect(p.minRR).toBe(2);
    expect(p.maxTrades).toBe(2);
  });

  it('produces the expected yes/no conditions in order', () => {
    expect(p.conditions).toEqual([
      'Identify 15 minute opening range',
      'Wait for 5 minute close outside ORB',
      'Wait for retest',
      'Retest must hold',
      'Momentum confirmation required',
    ]);
  });

  it('reads explicit end times and PM shorthand', () => {
    const q = parseStrategyText('I trade NQ from 9:30 until 11:00. Max 1 trade.');
    expect(q.instrument).toBe('NQ');
    expect(q.entryWindowStart).toBe('09:30');
    expect(q.entryWindowEnd).toBe('11:00');
    expect(parseStrategyText('Only after 1:30 on MES').entryWindowStart).toBe('13:30');
  });

  it('distinguishes MNQ and MES from NQ and ES', () => {
    expect(parseStrategyText('I scalp MNQ').instrument).toBe('MNQ');
    expect(parseStrategyText('MES only').instrument).toBe('MES');
  });

  it('detects bias requirements', () => {
    const q = parseStrategyText('Only trade with the 1H trend on ES.');
    expect(q.requiresBiasAlignment).toBe(true);
    expect(q.biasRequirement).toBe('1H trend');
  });

  it("keeps unrecognized rule-like sentences in the trader's words", () => {
    const q = parseStrategyText('I trade ES. Wait for the first pullback to the 20 EMA. No trades on FOMC days.');
    expect(q.conditions).toContain('Wait for the first pullback to the 20 EMA');
    expect(q.conditions).toContain('No trades on FOMC days');
  });

  it('returns an empty parse for empty input', () => {
    const q = parseStrategyText('   ');
    expect(q.conditions).toEqual([]);
    expect(q.minRR).toBeNull();
  });
});

describe('strategyFromParsed + strategyRules', () => {
  it('builds a strategy whose rules list matches the review checklist', () => {
    const s = strategyFromParsed(parseStrategyText(STRATEGY_EXAMPLE), makeStrategy({ checklist: [] }), STRATEGY_EXAMPLE);
    expect(s.markets).toEqual(['ES']);
    expect(s.typicalStopMax).toBe(5);
    const labels = strategyRules(s).map((r) => r.label);
    expect(labels[0]).toMatch(/9:45 AM/);
    expect(labels).toContain('Stop loss 5 points max');
    expect(labels).toContain('Minimum 1:2 risk/reward');
    expect(labels).toContain('Maximum 2 trades per day');
    expect(labels.length).toBe(9);
  });
});
