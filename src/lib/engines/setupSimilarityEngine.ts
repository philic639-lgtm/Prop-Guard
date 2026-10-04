import type { PracticeScenario, SetupFingerprint } from '@/types/practice';

/**
 * Similarity-engine foundation. Setups are reduced to a normalized fingerprint
 * and compared with a deterministic weighted score. Aggregate statistics over
 * similar setups are only produced from VERIFIED historical data with a
 * sufficient sample — never from educational samples.
 */

export function createSetupFingerprint(s: PracticeScenario): SetupFingerprint {
  return {
    instrument: s.instrument,
    strategyId: s.strategyId,
    direction: s.direction,
    trend: s.marketContext.trend,
    higherTimeframeBias: s.marketContext.higherTimeframeBias,
    volatility: s.marketContext.volatility,
    retestNumber: s.setupCharacteristics.retestNumber,
    openingRangeSize: s.marketContext.openingRangeSize,
    breakoutStrength: s.setupCharacteristics.breakoutStrength,
    sessionTime: s.session,
    riskReward: s.idealTrade?.riskReward,
  };
}

const WEIGHTS = {
  strategyId: 0.24,
  direction: 0.14,
  instrument: 0.1,
  trend: 0.1,
  higherTimeframeBias: 0.1,
  retestNumber: 0.1,
  volatility: 0.06,
  breakoutStrength: 0.06,
  sessionTime: 0.04,
  openingRangeSize: 0.03,
  riskReward: 0.03,
} as const;

/** Same underlying market (ES≈MES, NQ≈MNQ…) counts as a partial instrument match. */
const UNDERLYING: Record<string, string> = { MES: 'ES', MNQ: 'NQ', MYM: 'YM', M2K: 'RTY', MCL: 'CL', MGC: 'GC' };
const underlying = (s: string) => UNDERLYING[s] ?? s;

function numericSimilarity(a: number | undefined, b: number | undefined): number | null {
  if (a == null || b == null) return null;
  const max = Math.max(Math.abs(a), Math.abs(b));
  return max === 0 ? 1 : Math.max(0, 1 - Math.abs(a - b) / max);
}

/** 0–1 weighted similarity. Missing fields are skipped and the weights renormalized. */
export function calculateSetupSimilarity(a: SetupFingerprint, b: SetupFingerprint): number {
  let score = 0;
  let weight = 0;
  const add = (w: number, v: number | null) => {
    if (v == null) return;
    score += w * v;
    weight += w;
  };
  add(WEIGHTS.strategyId, a.strategyId === b.strategyId ? 1 : 0);
  add(WEIGHTS.direction, a.direction === b.direction ? 1 : 0);
  add(WEIGHTS.instrument, a.instrument === b.instrument ? 1 : underlying(a.instrument) === underlying(b.instrument) ? 0.8 : 0);
  add(WEIGHTS.trend, a.trend === b.trend ? 1 : 0);
  add(WEIGHTS.higherTimeframeBias, a.higherTimeframeBias === b.higherTimeframeBias ? 1 : 0);
  add(WEIGHTS.retestNumber, a.retestNumber == null || b.retestNumber == null ? null : a.retestNumber === b.retestNumber ? 1 : Math.abs(a.retestNumber - b.retestNumber) === 1 ? 0.5 : 0);
  add(WEIGHTS.volatility, a.volatility === b.volatility ? 1 : 0);
  add(WEIGHTS.breakoutStrength, a.breakoutStrength == null || b.breakoutStrength == null ? null : a.breakoutStrength === b.breakoutStrength ? 1 : 0);
  add(WEIGHTS.sessionTime, a.sessionTime == null || b.sessionTime == null ? null : a.sessionTime === b.sessionTime ? 1 : 0);
  add(WEIGHTS.openingRangeSize, numericSimilarity(a.openingRangeSize, b.openingRangeSize));
  add(WEIGHTS.riskReward, numericSimilarity(a.riskReward, b.riskReward));
  return weight > 0 ? Math.round((score / weight) * 1000) / 1000 : 0;
}

export const MIN_VERIFIED_SIMILAR = 30;
export const SIMILARITY_THRESHOLD = 0.75;

export interface SimilarSetupStats {
  available: boolean;
  /** Why statistics are (not) shown. */
  reason: string;
  matches?: number;
  continuationRate?: number;
}

/**
 * Statistics over similar historical setups. Returns `available: false` unless
 * enough similar scenarios come from verified historical data.
 */
export function similarSetupStats(target: SetupFingerprint, history: readonly PracticeScenario[], minSample = MIN_VERIFIED_SIMILAR): SimilarSetupStats {
  const verified = history.filter((s) => s.source.verified && s.source.kind === 'historical');
  if (!verified.length) return { available: false, reason: 'No verified historical market data is connected yet.' };
  const similar = verified.filter((s) => calculateSetupSimilarity(target, createSetupFingerprint(s)) >= SIMILARITY_THRESHOLD);
  if (similar.length < minSample) return { available: false, reason: `Only ${similar.length} verified similar setups — at least ${minSample} are needed.` };
  const traded = similar.filter((s) => s.outcome.targetReached != null || s.outcome.stopReached != null);
  const cont = traded.filter((s) => s.outcome.targetReached).length;
  return { available: true, reason: 'Based on verified historical data.', matches: similar.length, continuationRate: traded.length ? cont / traded.length : undefined };
}
