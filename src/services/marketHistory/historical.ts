import { getTemplate } from '@/data/strategyLibrary';
import { generateScenariosFromBars } from '@/lib/engines/historicalScenarioGenerator';
import { hasEvaluator } from '@/lib/engines/strategyEvaluators';
import { MockHistoricalProvider } from '@/services/market-data/MockHistoricalProvider';
import type { HistoricalScenario } from '@/types/marketHistory';
import type { PracticeLevel, PracticeScenario } from '@/types/practice';

/**
 * Bridges generated historical scenarios into the existing Practice Mode model.
 * Pre-decision and post-decision bars are concatenated here only for the
 * replay chart; the trainer reveals post-decision bars after the decision is locked.
 */

const LEVEL_KIND: Record<string, PracticeLevel['kind']> = {
  orb_high: 'orb_high',
  orb_low: 'orb_low',
  pdh: 'pdh',
  pdl: 'pdl',
  support: 'support',
  resistance: 'resistance',
  swing_high: 'swing_high',
  swing_low: 'swing_low',
  prior_close: 'prior_close',
};

export function historicalToPracticeScenario(h: HistoricalScenario): PracticeScenario {
  const t = getTemplate(h.strategyId);
  const candles = [...h.preBars, ...h.postBars].map((b) => ({ ...b }));
  const decisionIndex = h.preBars.length - 1;
  const risk = Math.abs(h.entry - h.stop);
  const f = h.features;
  const failed = h.checks.filter((c) => !c.passed);
  const bias: PracticeScenario['marketContext']['higherTimeframeBias'] = f.trend === 'up' ? 'bullish' : f.trend === 'down' ? 'bearish' : 'neutral';
  const minutes = f.timeOfDayMinutes;
  const vwap = h.vwap.every((v) => v != null) ? (h.vwap as number[]) : undefined;
  return {
    id: h.id,
    instrument: h.instrument,
    strategyId: h.strategyId,
    strategyName: h.strategyName,
    date: h.etDate,
    session: minutes < 12 * 60 ? 'morning' : 'afternoon',
    difficulty: !h.valid ? 'Advanced' : f.breakoutStrength === 'strong' ? 'Beginner' : 'Intermediate',
    direction: h.direction,
    quality: h.valid ? 'standard' : 'trap',
    source: h.verified
      ? { kind: 'historical', verified: true, provider: h.provider, note: `Recorded market data from ${h.provider}.` }
      : { kind: h.historical ? 'historical' : 'simulated', verified: false, provider: h.provider, note: h.historical ? 'Historical data from an unverified source.' : 'SIMULATED bars from the development data generator — not real market data.' },
    marketContext: {
      higherTimeframeBias: bias,
      trend: f.trend === 'up' ? 'uptrend' : f.trend === 'down' ? 'downtrend' : 'range',
      volatility: f.atrPct == null ? 'normal' : f.atrPct > 0.12 ? 'high' : f.atrPct < 0.05 ? 'low' : 'normal',
      openingRangeSize: f.orbSize ?? undefined,
      notes: `${h.timeframe} chart`,
    },
    candles,
    decisionIndex,
    levels: h.levels.map((l) => ({ label: l.label, price: l.price, kind: LEVEL_KIND[l.kind] ?? 'resistance' })),
    vwap,
    openingRange: undefined,
    idealDecision: h.valid ? h.direction : 'wait',
    idealTrade: { entry: h.entry, stop: h.stop, target: h.target, riskReward: h.riskReward },
    idealEntryZone: [h.entry - risk * 0.15, h.entry + risk * 0.15],
    setupCharacteristics: {
      retestNumber: f.retestNumber,
      firstRetest: f.retestNumber === 1,
      trendAligned: (h.direction === 'long' && f.trend === 'up') || (h.direction === 'short' && f.trend === 'down'),
      breakoutStrength: f.breakoutStrength,
    },
    explanation: h.checks.map((c) => `${c.passed ? '✓' : '✕'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`),
    lesson: h.valid
      ? `Every ${h.strategyName} rule was met at the decision bar. Judge the trade by that process — the outcome of one trade does not change whether it was a valid setup.`
      : `Not every ${h.strategyName} rule was met (${failed.map((c) => c.label).join(', ')}). The plan says skip.`,
    commonMistake: t?.avoidConditions[0] ? `Ignoring the rule to avoid: ${t.avoidConditions[0].toLowerCase()}.` : 'Entering before every rule is confirmed.',
    badges: [],
    timeframe: h.timeframe,
    historical: {
      scenarioId: h.id,
      provider: h.provider,
      decisionTimestamp: h.decisionTimestamp,
      checks: h.checks,
      features: h.features,
      outcome: h.outcome,
    },
    outcome: {
      result: !h.valid ? 'no-trade' : h.outcome.status === 'target' ? 'win' : h.outcome.status === 'stop' ? 'loss' : 'no-trade',
      targetReached: h.outcome.status === 'target',
      stopReached: h.outcome.status === 'stop',
      maxFavorableExcursion: h.outcome.mfePoints,
      maxAdverseExcursion: h.outcome.maePoints,
      summary:
        h.outcome.status === 'target'
          ? `The planned trade reached its 1:${h.riskReward} target${h.outcome.timeToTargetMinutes != null ? ` after ${h.outcome.timeToTargetMinutes} minutes` : ''}.`
          : h.outcome.status === 'stop'
            ? `The planned trade hit its stop${h.outcome.ambiguous ? ' (stop and target were inside the same bar — counted as a stop)' : ''}.`
            : `Neither stop nor target was reached before the session window ended (${h.outcome.rrAchieved}R at the end).`,
    },
  };
}

// ───────────────────────── On-device SIMULATED scenarios (development) ─────────────────────────

export const SIMULATED_INSTRUMENTS = ['ES', 'MES', 'NQ', 'MNQ'] as const;
export const SIMULATED_STRATEGIES = ['orb-15', 'pdh-breakout', 'pdl-breakdown', 'vwap-reclaim'] as const;
const SIM_RANGE = { start: '2025-03-03T00:00:00Z', end: '2025-04-12T00:00:00Z' };

let simulatedCache: { historical: HistoricalScenario[]; practice: PracticeScenario[] } | null = null;

/**
 * Real detection + outcome logic run on SIMULATED bars, so Historical Practice
 * works before any data provider is connected. Every scenario is tagged
 * `simulated` and is never counted as verified evidence.
 */
export function simulatedScenarios() {
  if (simulatedCache) return simulatedCache;
  const mock = new MockHistoricalProvider({ instruments: [...SIMULATED_INSTRUMENTS] });
  const historical: HistoricalScenario[] = [];
  // Micro contracts share the underlying's prices: detect once, relabel for the micro.
  const MICRO: Record<string, string> = { ES: 'MES', NQ: 'MNQ' };
  for (const instrument of ['ES', 'NQ']) {
    const bars = mock.getHistoricalBarsSync({ instrument, timeframe: '5m', startTime: SIM_RANGE.start, endTime: SIM_RANGE.end });
    for (const strategyId of SIMULATED_STRATEGIES) {
      if (!hasEvaluator(strategyId)) continue;
      const list = generateScenariosFromBars({ instrument, timeframe: '5m', strategyId, provider: mock.id, verified: false, historical: false, bars, maxPostBars: 36 });
      historical.push(...list);
      historical.push(...list.map((h) => ({ ...h, instrument: MICRO[instrument], id: h.id.replace(`-${instrument.toLowerCase()}-`, `-${MICRO[instrument].toLowerCase()}-`) })));
    }
  }
  simulatedCache = { historical, practice: historical.map(historicalToPracticeScenario) };
  return simulatedCache;
}

export const simulatedReady = () => simulatedCache != null;

// ───────────────────────── Verified scenarios loaded from Supabase ─────────────────────────

let verified: HistoricalScenario[] = [];
const listeners = new Set<() => void>();

export function setVerifiedScenarios(list: HistoricalScenario[]) {
  verified = list.filter((h) => h.verified);
  verifiedPractice = verified.map(historicalToPracticeScenario);
  listeners.forEach((l) => l());
}
let verifiedPractice: PracticeScenario[] = [];

export const getVerifiedHistorical = () => verified;
export const getVerifiedPractice = () => verifiedPractice;
export function onVerifiedScenariosChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
