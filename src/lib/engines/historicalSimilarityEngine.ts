import type { HistoricalScenario } from '@/types/marketHistory';

import type { SetupFeatures } from './strategyEvaluators/types';

/**
 * Compare a setup with previously stored, VERIFIED historical setups and
 * summarize what happened to the similar ones. Deterministic weighted
 * similarity — no model, no invented numbers. Small samples are flagged and
 * statistics are withheld below the minimum.
 */

export const MIN_HISTORICAL_SAMPLE = 20;
export const DEFAULT_MIN_SIMILARITY = 0.7;

export interface SimilarityTarget {
  strategyId: string;
  instrument: string;
  direction: 'long' | 'short';
  features: SetupFeatures;
}

export type SimilarityRecord = SimilarityTarget & Pick<HistoricalScenario, 'id' | 'verified' | 'valid' | 'outcome'>;

const UNDERLYING: Record<string, string> = { MES: 'ES', MNQ: 'NQ', MYM: 'YM', M2K: 'RTY', MCL: 'CL', MGC: 'GC' };
const und = (s: string) => UNDERLYING[s] ?? s;

const WEIGHTS = {
  strategy: 0.2,
  direction: 0.12,
  instrument: 0.1,
  timeOfDay: 0.1,
  trend: 0.1,
  orbSize: 0.08,
  vwapDistance: 0.08,
  relativeVolume: 0.06,
  volatility: 0.05,
  pdRelation: 0.05,
  gap: 0.04,
  session: 0.02,
} as const;

/** 1 when equal, decaying linearly to 0 at `scale` apart. */
const near = (a: number | null, b: number | null, scale: number) => (a == null || b == null ? null : Math.max(0, 1 - Math.abs(a - b) / scale));

export function setupSimilarity(a: SimilarityTarget, b: SimilarityTarget): number {
  let sum = 0;
  let w = 0;
  const add = (weight: number, v: number | null) => {
    if (v == null) return;
    sum += weight * v;
    w += weight;
  };
  const fa = a.features;
  const fb = b.features;
  add(WEIGHTS.strategy, a.strategyId === b.strategyId ? 1 : 0);
  add(WEIGHTS.direction, a.direction === b.direction ? 1 : 0);
  add(WEIGHTS.instrument, a.instrument === b.instrument ? 1 : und(a.instrument) === und(b.instrument) ? 0.85 : 0);
  add(WEIGHTS.timeOfDay, near(fa.timeOfDayMinutes, fb.timeOfDayMinutes, 120));
  add(WEIGHTS.trend, fa.trend === fb.trend ? 1 : fa.trend === 'flat' || fb.trend === 'flat' ? 0.4 : 0);
  add(WEIGHTS.orbSize, near(fa.orbSizeAtr, fb.orbSizeAtr, 3));
  add(WEIGHTS.vwapDistance, near(fa.vwapDistanceAtr, fb.vwapDistanceAtr, 3));
  add(WEIGHTS.relativeVolume, near(fa.relativeVolume, fb.relativeVolume, 1.5));
  add(WEIGHTS.volatility, near(fa.atrPct, fb.atrPct, Math.max(fa.atrPct ?? 0, fb.atrPct ?? 0, 0.01)));
  add(WEIGHTS.pdRelation, fa.pdRelation === 'unknown' || fb.pdRelation === 'unknown' ? null : fa.pdRelation === fb.pdRelation ? 1 : 0);
  add(WEIGHTS.gap, near(fa.gapPct, fb.gapPct, 1));
  add(WEIGHTS.session, fa.session === fb.session ? 1 : 0);
  return w > 0 ? Math.round((sum / w) * 1000) / 1000 : 0;
}

export interface HistoricalSimilarityStats {
  sampleSize: number;
  /** Share of resolved trades that hit target before stop. */
  winRate: number | null;
  averageR: number | null;
  medianR: number | null;
  /** In R units. */
  averageMAE: number | null;
  averageMFE: number | null;
  medianMFE: number | null;
  /** Share that reached +2R before the stop. */
  reached2RRate: number | null;
  /** Median adverse excursion of winning trades — the typical pullback survived. */
  typicalWinnerMAE: number | null;
  similarityScore: number | null;
  limited: boolean;
  message: string;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
}

export interface FindSimilarOptions {
  minSimilarity?: number;
  excludeId?: string;
  /** Default true. Unverified (simulated/sample) records never contribute to statistics. */
  verifiedOnly?: boolean;
  minSample?: number;
}

export function findSimilarHistoricalSetups(target: SimilarityTarget, pool: readonly SimilarityRecord[], opts: FindSimilarOptions = {}): HistoricalSimilarityStats {
  const minSim = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  const minSample = opts.minSample ?? MIN_HISTORICAL_SAMPLE;
  const verifiedOnly = opts.verifiedOnly ?? true;
  const matches = pool
    .filter((r) => r.id !== opts.excludeId && r.valid && (!verifiedOnly || r.verified))
    .map((r) => ({ r, sim: setupSimilarity(target, r) }))
    .filter((x) => x.sim >= minSim);
  const n = matches.length;
  const empty: HistoricalSimilarityStats = {
    sampleSize: n,
    winRate: null,
    averageR: null,
    medianR: null,
    averageMAE: null,
    averageMFE: null,
    medianMFE: null,
    reached2RRate: null,
    typicalWinnerMAE: null,
    similarityScore: n ? avg(matches.map((m) => m.sim)) : null,
    limited: true,
    message:
      verifiedOnly && !pool.some((r) => r.verified)
        ? 'No verified historical data is available yet — statistics are not shown.'
        : `Limited historical sample (${n} similar verified setup${n === 1 ? '' : 's'}; ${minSample} needed).`,
  };
  if (n < minSample) return empty;
  const outs = matches.map((m) => m.r.outcome);
  const resolved = outs.filter((o) => o.status !== 'open');
  const winners = outs.filter((o) => o.status === 'target');
  return {
    sampleSize: n,
    winRate: resolved.length ? Math.round((winners.length / resolved.length) * 1000) / 1000 : null,
    averageR: avg(outs.map((o) => o.rrAchieved)),
    medianR: median(outs.map((o) => o.rrAchieved)),
    averageMAE: avg(outs.map((o) => o.maeR)),
    averageMFE: avg(outs.map((o) => o.mfeR)),
    medianMFE: median(outs.map((o) => o.mfeR)),
    reached2RRate: Math.round((outs.filter((o) => o.maxR >= 2).length / n) * 1000) / 1000,
    typicalWinnerMAE: median(winners.map((o) => o.maeR)),
    similarityScore: avg(matches.map((m) => m.sim)),
    limited: false,
    message: `${n} similar verified setups found.`,
  };
}

/** Plain-language lines for the review — only produced from sufficient verified data. */
export function similarityHighlights(stats: HistoricalSimilarityStats, userStopR?: number | null): string[] {
  if (stats.limited) return [stats.message];
  const lines = [`${stats.sampleSize} similar verified setups found.`];
  if (stats.reached2RRate != null) lines.push(`${Math.round(stats.reached2RRate * 100)}% reached 2R before the stop.`);
  if (stats.medianMFE != null) lines.push(`Median favorable excursion: ${stats.medianMFE}R.`);
  if (userStopR != null && stats.typicalWinnerMAE != null && userStopR < stats.typicalWinnerMAE) {
    lines.push('Your stop was tighter than the typical pullback seen in similar setups.');
  }
  lines.push('Historical results describe the past and do not guarantee future outcomes.');
  return lines;
}
