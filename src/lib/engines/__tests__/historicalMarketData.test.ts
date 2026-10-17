import { MockHistoricalProvider } from '@/services/market-data/MockHistoricalProvider';
import { historicalStatsFor } from '@/features/practice/historical';
import { historicalToPracticeScenario, simulatedScenarios } from '@/services/marketHistory/historical';
import { historicalScenarioProvider, scenarioProvider } from '@/services/marketHistory';
import type { HistoricalScenario } from '@/types/marketHistory';

import { composeEdgeScore, historicalEdgeComponent } from '../edgeScoreEngine';
import { computeTradeOutcome } from '../historicalOutcomeEngine';
import { generateScenariosFromBars, scenarioId } from '../historicalScenarioGenerator';
import { findSimilarHistoricalSetups, MIN_HISTORICAL_SAMPLE, setupSimilarity, similarityHighlights, type SimilarityRecord } from '../historicalSimilarityEngine';
import { etParts } from '../marketTime';
import { scoreTrainerDecision } from '../practiceScoringEngine';
import { getEvaluator, scanForSignals, type OhlcvBar, type SetupFeatures } from '../strategyEvaluators';

// ───────────────────────────── Outcome engine ─────────────────────────────

const T0 = '2025-03-03T15:00:00.000Z';
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const b = (min: number, open: number, high: number, low: number, close: number): OhlcvBar => ({ timestamp: at(min), open, high, low, close, volume: 100 });
const LONG = { direction: 'long' as const, entry: 100, stop: 98, target: 104 };

describe('historical outcome engine', () => {
  it('target before stop', () => {
    const o = computeTradeOutcome(T0, [b(5, 100, 101, 99.5, 100.5), b(10, 100.5, 104.5, 100, 104), b(15, 104, 104, 97, 97)], LONG);
    expect(o).toMatchObject({ status: 'target', targetHitFirst: true, stopHitFirst: false, ambiguous: false, exitIndex: 1, exitPrice: 104, rrAchieved: 2, timeToTargetMinutes: 10, timeToStopMinutes: null });
    expect(o.maeR).toBe(0.25); // pulled back to 99.5 before winning
    expect(o.mfeR).toBe(2.25);
  });

  it('stop before target', () => {
    const o = computeTradeOutcome(T0, [b(5, 100, 101, 99, 99.5), b(10, 99.5, 99.5, 97.5, 98), b(15, 98, 106, 98, 105)], LONG);
    expect(o).toMatchObject({ status: 'stop', stopHitFirst: true, targetHitFirst: false, ambiguous: false, exitIndex: 1, exitPrice: 98, rrAchieved: -1, timeToStopMinutes: 10 });
    expect(o.maxR).toBe(0.5);
    // Best R in the window includes the move after the stop — "the trade worked, the stop was too tight".
    expect(o.bestRAfterEntry).toBe(3);
  });

  it('same-candle conflict resolves conservatively as a stop and is flagged ambiguous', () => {
    const o = computeTradeOutcome(T0, [b(5, 100, 105, 97, 101)], LONG);
    expect(o).toMatchObject({ status: 'stop', ambiguous: true, exitPrice: 98, rrAchieved: -1 });
  });

  it('a gap through the stop exits at the open (worse than the stop)', () => {
    const o = computeTradeOutcome(T0, [b(5, 97, 97.5, 96.5, 97)], LONG);
    expect(o).toMatchObject({ status: 'stop', ambiguous: false, exitPrice: 97, rrAchieved: -1.5 });
  });

  it('short trades mirror long logic', () => {
    const o = computeTradeOutcome(T0, [b(5, 100, 100.5, 96, 96.5)], { direction: 'short', entry: 100, stop: 102, target: 96 });
    expect(o).toMatchObject({ status: 'target', rrAchieved: 2 });
  });

  it('open at the end of the window marks to market', () => {
    const o = computeTradeOutcome(T0, [b(5, 100, 101, 99, 101), b(10, 101, 102, 100.5, 101)], LONG);
    expect(o).toMatchObject({ status: 'open', exitIndex: null, rrAchieved: 0.5, durationMinutes: 10 });
  });
});

// ───────────────────────────── Detection: no lookahead ─────────────────────────────

const mock = new MockHistoricalProvider({ instruments: ['ES'] });
const ES = mock.getHistoricalBarsSync({ instrument: 'ES', timeframe: '5m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-04-12T00:00:00Z' });
const STRATEGIES = ['orb-15', 'pdh-breakout', 'pdl-breakdown', 'vwap-reclaim'];

describe('shared strategy evaluators — no lookahead', () => {
  it('finds signals on simulated bars', () => {
    const total = STRATEGIES.reduce((n, id) => n + scanForSignals(getEvaluator(id)!, 'ES', ES, { includeInvalid: true }).length, 0);
    expect(total).toBeGreaterThan(5);
  });

  it.each(STRATEGIES)('%s: history truncated at the decision bar produces the same signal', (id) => {
    const ev = getEvaluator(id)!;
    const full = scanForSignals(ev, 'ES', ES, { includeInvalid: true });
    for (const sig of full.slice(0, 6)) {
      const truncated = scanForSignals(ev, 'ES', ES.slice(0, sig.decisionIndex + 1), { includeInvalid: true });
      const same = truncated.find((s) => s.decisionTimestamp === sig.decisionTimestamp);
      expect(same).toEqual(sig);
    }
  });

  it.each(STRATEGIES)('%s: rewriting every future bar does not change detection', (id) => {
    const ev = getEvaluator(id)!;
    const full = scanForSignals(ev, 'ES', ES, { includeInvalid: true });
    const sig = full[0];
    if (!sig) return;
    // Replace everything after the decision bar with a violent, opposite path.
    const tampered = ES.map((x, i) => (i <= sig.decisionIndex ? x : { ...x, open: x.open * 0.9, high: x.high * 0.95, low: x.low * 0.85, close: x.close * 0.86, volume: x.volume * 7 }));
    const again = scanForSignals(ev, 'ES', tampered, { includeInvalid: true }).filter((s) => s.decisionIndex <= sig.decisionIndex);
    expect(again).toEqual(full.filter((s) => s.decisionIndex <= sig.decisionIndex));
  });
});

// ───────────────────────────── Scenario generation ─────────────────────────────

describe('historical scenario generator', () => {
  const scenarios = STRATEGIES.flatMap((strategyId) => generateScenariosFromBars({ instrument: 'ES', timeframe: '5m', strategyId, provider: 'mock', verified: false, historical: false, bars: ES }));

  it('generates scenarios with frozen pre-decision and separate post-decision candles', () => {
    expect(scenarios.length).toBeGreaterThan(5);
    for (const s of scenarios) {
      expect(s.preBars[s.preBars.length - 1].timestamp).toBe(s.decisionTimestamp);
      expect(s.postBars.every((p) => p.timestamp > s.decisionTimestamp)).toBe(true);
      // Post-decision candles stay within the same session.
      expect(s.postBars.every((p) => etParts(p.timestamp).date === s.etDate)).toBe(true);
      expect(s.id).toBe(scenarioId('mock', 'ES', '5m', s.strategyId, s.decisionTimestamp));
      expect(s.verified).toBe(false);
    }
  });

  it('computes the outcome from post-decision candles only', () => {
    for (const s of scenarios) {
      expect(s.outcome).toEqual(computeTradeOutcome(s.decisionTimestamp, s.postBars, { direction: s.direction, entry: s.entry, stop: s.stop, target: s.target }));
    }
  });

  it('changing the future changes the outcome but never the setup', () => {
    const s = scenarios.find((x) => x.valid) ?? scenarios[0];
    const i = ES.findIndex((x) => x.timestamp === s.decisionTimestamp);
    const crash = ES.map((x, k) => (k <= i ? x : { ...x, open: s.stop - 50, high: s.stop - 40, low: s.stop - 60, close: s.stop - 55 }));
    const rerun = generateScenariosFromBars({ instrument: 'ES', timeframe: '5m', strategyId: s.strategyId, provider: 'mock', verified: false, historical: false, bars: crash }).find((x) => x.decisionTimestamp === s.decisionTimestamp)!;
    expect(rerun).toBeDefined();
    expect({ ...rerun, outcome: null, postBars: null, vwap: null }).toEqual({ ...s, outcome: null, postBars: null, vwap: null });
    if (s.direction === 'long') expect(rerun.outcome.status).toBe('stop');
  });

  it('simulated scenarios are labelled SIMULATED and never verified', () => {
    const sim = simulatedScenarios();
    expect(sim.practice.length).toBeGreaterThan(10);
    expect(sim.practice.every((p) => p.source.kind === 'simulated' && !p.source.verified)).toBe(true);
    expect(sim.historical.every((h) => !h.verified && !h.historical)).toBe(true);
    // Micro contracts reuse the underlying's scenarios under their own ids.
    expect(sim.practice.some((p) => p.instrument === 'MES' && p.id.includes('-mes-'))).toBe(true);
    // Reachable through the catalog only when historical scenarios are requested.
    expect(scenarioProvider.list().some((p) => p.historical)).toBe(false);
    expect(scenarioProvider.list({ source: 'historical' }).length).toBe(historicalScenarioProvider.list().length);
    expect(scenarioProvider.get(sim.practice[0].id)?.id).toBe(sim.practice[0].id);
  });

  it('maps valid setups to a trade decision and near-misses to SKIP', () => {
    for (const h of scenarios) {
      const p = historicalToPracticeScenario(h);
      expect(p.idealDecision).toBe(h.valid ? h.direction : 'wait');
      expect(p.decisionIndex).toBe(h.preBars.length - 1);
      expect(p.candles).toHaveLength(h.preBars.length + h.postBars.length);
    }
  });
});

// ───────────────────────────── Similarity ─────────────────────────────

const F: SetupFeatures = {
  timeOfDayMinutes: 600,
  session: 'ny_morning',
  trend: 'up',
  orbSize: 10,
  orbSizeAtr: 1.2,
  relativeVolume: 1.3,
  vwapDistanceAtr: 0.4,
  atr: 8,
  atrPct: 0.08,
  pdRelation: 'inside',
  gapPct: 0.2,
  retestNumber: 1,
  breakoutStrength: 'normal',
};

const outcomeOf = (status: 'target' | 'stop', maeR: number, mfeR: number) => ({
  ...computeTradeOutcome(T0, [], LONG),
  status,
  stopHitFirst: status === 'stop',
  targetHitFirst: status === 'target',
  rrAchieved: status === 'target' ? 2 : -1,
  maeR,
  mfeR,
  maxR: mfeR,
});

function records(n: number, verified = true): SimilarityRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    strategyId: 'orb-15',
    instrument: 'ES',
    direction: 'long' as const,
    features: { ...F, timeOfDayMinutes: 600 + (i % 5) * 5 },
    verified,
    valid: true,
    // 15 of every 25: winners with ~0.6R pullbacks; the rest stop out.
    outcome: i % 5 < 3 ? outcomeOf('target', 0.6, 2.4) : outcomeOf('stop', 1, 0.5),
  }));
}
const TARGET = { strategyId: 'orb-15', instrument: 'ES', direction: 'long' as const, features: F };

describe('historical similarity engine', () => {
  it('scores identical setups 1 and penalizes different strategy / direction', () => {
    expect(setupSimilarity(TARGET, TARGET)).toBe(1);
    expect(setupSimilarity(TARGET, { ...TARGET, direction: 'short' })).toBeLessThan(0.9);
    expect(setupSimilarity(TARGET, { ...TARGET, strategyId: 'vwap-reclaim', direction: 'short', features: { ...F, trend: 'down' } })).toBeLessThan(0.7);
    // Micro and underlying are treated as nearly the same market.
    expect(setupSimilarity(TARGET, { ...TARGET, instrument: 'MES' })).toBeGreaterThan(0.95);
  });

  it('calculates statistics from enough verified similar setups', () => {
    const s = findSimilarHistoricalSetups(TARGET, records(25));
    expect(s.limited).toBe(false);
    expect(s.sampleSize).toBe(25);
    expect(s.winRate).toBe(0.6);
    expect(s.averageR).toBe(0.8); // (15×2 − 10×1) / 25
    expect(s.medianR).toBe(2);
    expect(s.reached2RRate).toBe(0.6);
    expect(s.medianMFE).toBe(2.4);
    expect(s.typicalWinnerMAE).toBe(0.6);
    expect(s.averageMAE).toBe(0.76);
    expect(s.similarityScore).toBeGreaterThan(0.9);
    expect(s.message).toBe('25 similar verified setups found.');
  });

  it('withholds statistics below the minimum sample and says so', () => {
    const s = findSimilarHistoricalSetups(TARGET, records(MIN_HISTORICAL_SAMPLE - 1));
    expect(s.limited).toBe(true);
    expect(s.winRate).toBeNull();
    expect(s.averageR).toBeNull();
    expect(s.message).toMatch(/^Limited historical sample/);
    expect(similarityHighlights(s)).toEqual([s.message]);
  });

  it('never counts unverified (simulated) setups as evidence', () => {
    const s = findSimilarHistoricalSetups(TARGET, records(50, false));
    expect(s.limited).toBe(true);
    expect(s.sampleSize).toBe(0);
    expect(s.message).toMatch(/No verified historical data/);
    // Simulated practice scenarios therefore never show statistics in the app.
    const sim = simulatedScenarios().practice[0];
    expect(historicalStatsFor(sim)?.limited).toBe(true);
  });

  it('produces review lines only from sufficient data, including the stop-size note', () => {
    const lines = similarityHighlights(findSimilarHistoricalSetups(TARGET, records(25)), 0.4);
    expect(lines).toEqual([
      '25 similar verified setups found.',
      '60% reached 2R before the stop.',
      'Median favorable excursion: 2.4R.',
      'Your stop was tighter than the typical pullback seen in similar setups.',
      'Historical results describe the past and do not guarantee future outcomes.',
    ]);
    expect(lines.join(' ')).not.toMatch(/guaranteed|will win|sure/i);
  });
});

// ───────────────────────────── Edge score & trainer scoring ─────────────────────────────

describe('edge score: verified history is one factor', () => {
  it('excludes limited historical evidence', () => {
    expect(historicalEdgeComponent({ sampleSize: 5, averageR: 1, winRate: 0.8, limited: true }).value).toBeNull();
    expect(historicalEdgeComponent({ sampleSize: 60, averageR: 0.8, winRate: 0.6, limited: false }).value).toBe(66);
  });

  it('adds historical evidence as one weighted component, never the whole score', () => {
    const base = { strategyQuality: 80, confirmations: 75, riskReward: 2, marketContext: 70 };
    const without = composeEdgeScore(base);
    const strong = composeEdgeScore({ ...base, historical: { sampleSize: 80, averageR: 2, winRate: 1, limited: false } });
    expect(without.missing).toContain('historicalEdge');
    expect(strong.used).toContain('historicalEdge');
    expect(strong.score!).toBeGreaterThan(without.score!);
    expect(strong.score!).toBeLessThan(100);
  });
});

describe('trainer scoring is about the decision, not the outcome', () => {
  const valid = simulatedScenarios().historical.find((h) => h.valid)!;
  const invalid = simulatedScenarios().historical.find((h) => !h.valid)!;
  const withOutcome = (h: HistoricalScenario, status: 'target' | 'stop') => historicalToPracticeScenario({ ...h, outcome: { ...h.outcome, status, rrAchieved: status === 'target' ? h.riskReward : -1 } });
  const planInput = (h: HistoricalScenario) => ({ decision: h.direction, entry: h.entry, stop: h.stop, target: h.target });

  it('a disciplined trade that loses scores the same as when it wins', () => {
    const won = scoreTrainerDecision(withOutcome(valid, 'target'), planInput(valid));
    const lost = scoreTrainerDecision(withOutcome(valid, 'stop'), planInput(valid));
    expect(lost.total).toBe(won.total);
    expect(lost.total).toBeGreaterThanOrEqual(80);
    expect(lost.breakdown?.map((x) => x.key)).toEqual(['direction', 'entryQuality', 'stopPlacement', 'targetPlacement', 'riskReward', 'ruleAdherence', 'decisionQuality']);
  });

  it('trading against the rules scores low even if it would have won', () => {
    const p = withOutcome(invalid, 'target');
    const traded = scoreTrainerDecision(p, planInput(invalid));
    const skipped = scoreTrainerDecision(p, { decision: 'wait' });
    expect(skipped.correct).toBe(true);
    expect(skipped.total).toBeGreaterThan(traded.total);
    expect(traded.mistakes.length).toBeGreaterThan(0);
  });

  it('wrong direction on a valid setup scores lower than the planned trade', () => {
    const p = historicalToPracticeScenario(valid);
    const right = scoreTrainerDecision(p, planInput(valid));
    const opposite = valid.direction === 'long' ? 'short' : 'long';
    const risk = Math.abs(valid.entry - valid.stop);
    const sign = opposite === 'long' ? 1 : -1;
    const wrong = scoreTrainerDecision(p, { decision: opposite, entry: valid.entry, stop: valid.entry - sign * risk, target: valid.entry + sign * 2 * risk });
    expect(wrong.total).toBeLessThan(right.total);
  });
});
