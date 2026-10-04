import { SAMPLE_SCENARIOS } from '@/data/practice/scenarios';
import { getTemplate } from '@/data/strategyLibrary';
import { PRACTICE_INSTRUMENTS } from '@/data/practice/scenarioFactory';
import { filterScenarios, scenarioProvider } from '@/services/marketHistory';
import type { PracticeAttempt, PracticeScenario } from '@/types/practice';

import { chooseSmartScenario, SMART_MIX } from '../adaptivePracticeEngine';
import { computeEdgeScore } from '../edgeScoreEngine';
import {
  calculateDirectionAccuracy,
  calculateRetestAccuracy,
  calculateStrategyAccuracy,
  calculateStreak,
  calculateStrongestSetup,
  calculateWeakestSetup,
  generatePracticeInsights,
  summarizePractice,
} from '../practiceAnalyticsEngine';
import { attemptResult, practiceTradeMetrics, scorePracticeDecision, simulatePracticeTrade, validatePracticeTrade } from '../practiceScoringEngine';
import { calculateSetupSimilarity, createSetupFingerprint, similarSetupStats } from '../setupSimilarityEngine';

const byId = (id: string) => scenarioProvider.get(id)!;

describe('sample scenarios (market-history layer)', () => {
  it('are clearly labelled as unverified educational samples', () => {
    expect(SAMPLE_SCENARIOS.length).toBeGreaterThanOrEqual(40);
    for (const s of SAMPLE_SCENARIOS) {
      expect(s.source.kind).toBe('educational_sample');
      expect(s.source.verified).toBe(false);
      expect(getTemplate(s.strategyId)).toBeDefined();
      expect(s.decisionIndex).toBeLessThan(s.candles.length - 3);
      for (const k of s.candles) expect(k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close)).toBe(true);
    }
  });

  it('cover every practice instrument, both directions and both answers', () => {
    expect(new Set(SAMPLE_SCENARIOS.map((s) => s.instrument))).toEqual(new Set(PRACTICE_INSTRUMENTS));
    expect(new Set(SAMPLE_SCENARIOS.map((s) => s.direction))).toEqual(new Set(['long', 'short']));
    expect(SAMPLE_SCENARIOS.some((s) => s.idealDecision === 'wait')).toBe(true);
    expect(SAMPLE_SCENARIOS.some((s) => s.quality === 'great')).toBe(true);
  });

  it('include rule-valid setups that lost (valid ≠ guaranteed)', () => {
    const valid = SAMPLE_SCENARIOS.filter((s) => s.idealDecision !== 'wait');
    expect(valid.some((s) => s.outcome.result === 'loss')).toBe(true);
    expect(valid.some((s) => s.outcome.result === 'win')).toBe(true);
  });

  it('ideal trades are consistent with the strategy R:R and direction', () => {
    for (const s of SAMPLE_SCENARIOS.filter((x) => x.idealTrade)) {
      const t = s.idealTrade!;
      if (s.idealDecision === 'long') expect(t.stop < t.entry && t.entry < t.target).toBe(true);
      else expect(t.target < t.entry && t.entry < t.stop).toBe(true);
      expect(t.riskReward).toBe(getTemplate(s.strategyId)!.defaultRiskReward);
    }
  });

  it('filters by instrument, strategy, direction, session and great setups', () => {
    expect(filterScenarios(SAMPLE_SCENARIOS, { instrument: 'CL' }).every((s) => s.instrument === 'CL')).toBe(true);
    expect(filterScenarios(SAMPLE_SCENARIOS, { strategyId: 'orb-15', direction: 'short' }).every((s) => s.strategyId === 'orb-15' && s.direction === 'short')).toBe(true);
    expect(filterScenarios(SAMPLE_SCENARIOS, { session: 'afternoon' }).length).toBeGreaterThan(0);
    expect(filterScenarios(SAMPLE_SCENARIOS, { greatOnly: true }).every((s) => s.quality === 'great' && s.badges.length > 0)).toBe(true);
  });
});

describe('trade metrics & replay', () => {
  it('computes risk, reward and R:R in points', () => {
    expect(practiceTradeMetrics('ES', 6032.25, 6027.25, 6042.25)).toMatchObject({ riskPoints: 5, rewardPoints: 10, rr: 2, riskTicks: 20, riskDollarsPerContract: 250 });
  });

  it('validates sides of stop and target', () => {
    expect(validatePracticeTrade({ decision: 'long', entry: 100, stop: 101, target: 105 })).toMatch(/stop must be below/);
    expect(validatePracticeTrade({ decision: 'short', entry: 100, stop: 101, target: 95 })).toBeNull();
    expect(validatePracticeTrade({ decision: 'wait' })).toBeNull();
  });

  it('replays the ideal trade to the recorded outcome', () => {
    for (const s of SAMPLE_SCENARIOS.filter((x) => x.idealTrade)) {
      const r = simulatePracticeTrade(s.candles, s.decisionIndex, { decision: s.idealDecision, ...s.idealTrade });
      expect(r.status).toBe(s.outcome.result === 'win' ? 'target' : 'stop');
    }
  });

  it('a trade into a WAIT scenario is stopped out', () => {
    const s = byId('sample-orb-third-retest-long-1');
    const close = s.candles[s.decisionIndex].close;
    const lo = Math.min(...s.candles.slice(3, s.decisionIndex + 1).map((k) => k.low));
    const r = simulatePracticeTrade(s.candles, s.decisionIndex, { decision: 'long', entry: close, stop: lo - 8, target: close + (close - lo + 8) * 2 });
    expect(r.status).toBe('stop');
    expect(attemptResult('long', 'wait', r)).toBe('loss');
    expect(attemptResult('wait', 'wait', r)).toBe('correct-wait');
  });
});

describe('Prop Guard practice score', () => {
  const s = byId('sample-orb-first-retest-long-1');
  const t = s.idealTrade!;

  it('scores the ideal trade as A+ excellent with strengths', () => {
    const score = scorePracticeDecision(s, { decision: 'long', ...t });
    expect(score.total).toBe(100);
    expect(score.grade).toBe('A+');
    expect(score.verdict).toBe('Excellent Setup');
    expect(score.correct).toBe(true);
    expect(score.strengths).toEqual(expect.arrayContaining(['Higher timeframe aligned', 'Recognised the first retest of the level']));
    expect(score.mistakes).toEqual([]);
  });

  it('is deterministic and penalises a late entry and a tight stop', () => {
    const late = { decision: 'long' as const, entry: t.entry + 2, stop: t.entry + 0.5, target: t.entry + 2 + 3 };
    const a = scorePracticeDecision(s, late);
    const b = scorePracticeDecision(s, late);
    expect(a).toEqual(b);
    expect(a.total).toBeLessThan(80);
    expect(a.mistakes.join(' ')).toMatch(/later \(chasing\)/);
    expect(a.mistakes.join(' ')).toMatch(/inside the structure/);
  });

  it('rewards a correct WAIT and penalises trading a trap', () => {
    const trap = byId('sample-orb-third-retest-long-1');
    expect(scorePracticeDecision(trap, { decision: 'wait' }).total).toBe(100);
    const bad = scorePracticeDecision(trap, { decision: 'long', entry: 100, stop: 99, target: 102 });
    expect(bad.correct).toBe(false);
    expect(bad.grade).toBe('D');
    expect(bad.mistakes.join(' ')).toMatch(/rules said WAIT/);
  });

  it('missing a valid setup with WAIT scores low but explains why', () => {
    const miss = scorePracticeDecision(s, { decision: 'wait' });
    expect(miss.correct).toBe(false);
    expect(miss.mistakes[0]).toMatch(/Missed a valid/);
  });
});

// ---------- user performance analytics ----------
let n = 0;
function attempt(over: Partial<PracticeAttempt>): PracticeAttempt {
  n++;
  return {
    id: `a${n}`,
    scenarioId: 'x',
    instrument: 'ES',
    strategyId: 'orb-15',
    strategyName: '15M ORB Retest',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
    mode: 'standard',
    session: 'morning',
    direction: 'long',
    decision: 'long',
    idealDecision: 'long',
    correct: true,
    score: 90,
    grade: 'A+',
    result: 'win',
    mistakes: [],
    setupCharacteristics: { retestNumber: 1 },
    ...over,
  };
}

describe('practice analytics', () => {
  const history = [
    ...Array.from({ length: 6 }, (_, i) => attempt({ correct: i < 5, setupCharacteristics: { retestNumber: 1 } })),
    ...Array.from({ length: 6 }, (_, i) => attempt({ correct: i < 2, decision: 'long', idealDecision: 'wait', setupCharacteristics: { retestNumber: 3 }, score: 40 })),
    ...Array.from({ length: 5 }, (_, i) => attempt({ correct: i < 2, direction: 'short', decision: 'short', idealDecision: 'short', instrument: 'NQ' })),
  ];

  it('computes accuracy by strategy, direction and retest', () => {
    expect(calculateStrategyAccuracy(history)[0]).toMatchObject({ key: 'orb-15', attempts: 17 });
    expect(calculateDirectionAccuracy(history).map((g) => g.key).sort()).toEqual(['long', 'short']);
    const retest = calculateRetestAccuracy(history);
    expect(retest.find((g) => g.key === '1')!.accuracy).toBeCloseTo(7 / 11);
    expect(retest.find((g) => g.key === '3')!.accuracy).toBeCloseTo(2 / 6);
  });

  it('finds the strongest and weakest specific setups only with enough attempts', () => {
    expect(calculateStrongestSetup(history)!.retest).toBe('First retest');
    expect(calculateWeakestSetup(history)!.retest).toBe('Third retest');
    expect(calculateStrongestSetup(history.slice(0, 4))).toBeNull();
  });

  it('only generates insights after enough attempts and a meaningful gap', () => {
    expect(generatePracticeInsights(history.slice(0, 9))).toEqual([]);
    const insights = generatePracticeInsights(history);
    expect(insights.some((i) => i.id === 'retest-orb-15')).toBe(true);
    for (const i of insights) expect(i.body).not.toMatch(/guarantee|certain|will win/i);
  });

  it('summarises streak, accuracy and average score', () => {
    const sum = summarizePractice(history);
    expect(sum.attempts).toBe(17);
    expect(sum.streak).toBe(0); // most recent attempt was incorrect
    expect(calculateStreak([attempt({}), attempt({})])).toBe(2);
    expect(summarizePractice([]).accuracy).toBeNull();
  });
});

describe('smart practice', () => {
  it('explores until there is enough history', () => {
    const pick = chooseSmartScenario(SAMPLE_SCENARIOS, [], 0.1, 0.5)!;
    expect(pick.bucket).toBe('explore');
  });

  it('targets the weakest area most of the time but keeps a balanced mix', () => {
    const weakHistory = Array.from({ length: 6 }, () => attempt({ strategyId: 'orb-15', direction: 'short', correct: false }));
    const strongHistory = Array.from({ length: 6 }, () => attempt({ strategyId: 'trend-pullback', direction: 'long', correct: true }));
    const all = [...weakHistory, ...strongHistory];
    const weak = chooseSmartScenario(SAMPLE_SCENARIOS, all, 0.1, 0.3)!;
    expect(weak.bucket).toBe('weak');
    expect(weak.scenario.strategyId).toBe('orb-15');
    expect(weak.scenario.direction).toBe('short');
    expect(weak.reason).toMatch(/less accurate/);
    expect(chooseSmartScenario(SAMPLE_SCENARIOS, all, SMART_MIX.weak + 0.1, 0.3)!.bucket).toBe('average');
    expect(chooseSmartScenario(SAMPLE_SCENARIOS, all, 0.95, 0.3)!.bucket).toBe('strong');
  });
});

describe('similarity & edge score foundations', () => {
  const a = byId('sample-orb-first-retest-long-1');
  const b = byId('sample-orb-first-retest-long-2');
  const c = byId('sample-sweep-reversal-short-1');

  it('scores similar setups higher than unrelated ones', () => {
    const fa = createSetupFingerprint(a);
    expect(calculateSetupSimilarity(fa, fa)).toBe(1);
    expect(calculateSetupSimilarity(fa, createSetupFingerprint(b))).toBeGreaterThan(calculateSetupSimilarity(fa, createSetupFingerprint(c)));
  });

  it('never reports similar-setup statistics from unverified samples', () => {
    const stats = similarSetupStats(createSetupFingerprint(a), SAMPLE_SCENARIOS);
    expect(stats.available).toBe(false);
    const fakeVerified: PracticeScenario[] = Array.from({ length: 5 }, (_, i) => ({ ...a, id: `v${i}`, source: { kind: 'historical', verified: true, note: '' } }));
    expect(similarSetupStats(createSetupFingerprint(a), fakeVerified).available).toBe(false); // below sample minimum
  });

  it('edge score only uses components with real data', () => {
    const e = computeEdgeScore({
      strategyMatch: { value: 90, source: 'rules' },
      riskReward: { value: 80, source: 'rules' },
      historicalEdge: { value: 99, source: 'user_history', sampleSize: 500 },
      personalEdge: { value: 70, source: 'user_history', sampleSize: 4 },
    });
    expect(e.used.sort()).toEqual(['riskReward', 'strategyMatch']);
    expect(e.missing).toEqual(expect.arrayContaining(['historicalEdge', 'personalEdge']));
    expect(e.score).toBe(Math.round((90 * 0.22 + 80 * 0.14) / 0.36));
    expect(computeEdgeScore({}).score).toBeNull();
  });
});
