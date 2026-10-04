/**
 * Prop Guard Edge Score foundation.
 *
 * Combines independent components into one 0–100 decision-support score.
 * A component is only included when its data is actually available
 * (`value !== null`); weights renormalize over what is present, and the
 * result lists what was missing. Historical edge stays null until verified
 * historical data exists — nothing is fabricated.
 */
export type EdgeComponentKey = 'strategyMatch' | 'historicalEdge' | 'personalEdge' | 'trendAlignment' | 'riskReward' | 'timing' | 'ruleCompliance';

export interface EdgeComponent {
  /** 0–100, or null when there is no reliable data for it. */
  value: number | null;
  source: 'rules' | 'user_history' | 'verified_history';
  /** Sample size behind data-driven components. */
  sampleSize?: number;
}

export const EDGE_WEIGHTS: Record<EdgeComponentKey, number> = {
  strategyMatch: 0.22,
  ruleCompliance: 0.18,
  riskReward: 0.14,
  trendAlignment: 0.12,
  timing: 0.08,
  personalEdge: 0.13,
  historicalEdge: 0.13,
};

/** Minimum samples before a data-driven component may be used. */
export const MIN_EDGE_SAMPLES: Partial<Record<EdgeComponentKey, number>> = { personalEdge: 10, historicalEdge: 30 };

export interface EdgeScore {
  score: number | null;
  used: EdgeComponentKey[];
  missing: EdgeComponentKey[];
  /** Share of total weight backed by data (0–1). */
  coverage: number;
}

export function computeEdgeScore(components: Partial<Record<EdgeComponentKey, EdgeComponent>>): EdgeScore {
  const used: EdgeComponentKey[] = [];
  const missing: EdgeComponentKey[] = [];
  let sum = 0;
  let weight = 0;
  for (const key of Object.keys(EDGE_WEIGHTS) as EdgeComponentKey[]) {
    const c = components[key];
    const minN = MIN_EDGE_SAMPLES[key];
    const usable =
      c != null &&
      c.value != null &&
      Number.isFinite(c.value) &&
      (minN == null || (c.sampleSize ?? 0) >= minN) &&
      (key !== 'historicalEdge' || c.source === 'verified_history');
    if (!usable) {
      missing.push(key);
      continue;
    }
    used.push(key);
    sum += Math.max(0, Math.min(100, c!.value!)) * EDGE_WEIGHTS[key];
    weight += EDGE_WEIGHTS[key];
  }
  return { score: weight > 0 ? Math.round(sum / weight) : null, used, missing, coverage: Math.round(weight * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Connecting verified historical similarity to the Edge Score
// ---------------------------------------------------------------------------

/** Minimal shape of historical similarity statistics needed here. */
export interface HistoricalEvidence {
  sampleSize: number;
  averageR: number | null;
  winRate: number | null;
  limited: boolean;
}

/**
 * Historical evidence as ONE edge component. Null (excluded) unless the sample
 * is verified and large enough. Maps average R and win rate onto 0–100 around
 * a neutral 50 — it never dominates the score on its own.
 */
export function historicalEdgeComponent(e: HistoricalEvidence | null | undefined): EdgeComponent {
  if (!e || e.limited || e.averageR == null) return { value: null, source: 'verified_history', sampleSize: e?.sampleSize ?? 0 };
  const fromR = 50 + e.averageR * 25;
  const fromWin = e.winRate != null ? e.winRate * 100 : fromR;
  return { value: Math.round(Math.max(0, Math.min(100, fromR * 0.6 + fromWin * 0.4))), source: 'verified_history', sampleSize: e.sampleSize };
}

export interface EdgeInputs {
  /** Strategy quality / rule match, 0–100. */
  strategyQuality: number | null;
  /** Share of current confirmations met, 0–100. */
  confirmations: number | null;
  /** Planned reward:risk (e.g. 2 = 1:2). */
  riskReward: number | null;
  /** Market-context alignment, 0–100. */
  marketContext: number | null;
  historical?: HistoricalEvidence | null;
  personal?: { value: number; sampleSize: number } | null;
}

/** Assemble components from the factors Prop Guard can actually measure. */
export function composeEdgeScore(i: EdgeInputs): EdgeScore {
  const rr = i.riskReward == null ? null : Math.max(0, Math.min(100, (i.riskReward / 3) * 100));
  return computeEdgeScore({
    strategyMatch: { value: i.strategyQuality, source: 'rules' },
    ruleCompliance: { value: i.confirmations, source: 'rules' },
    riskReward: { value: rr, source: 'rules' },
    trendAlignment: { value: i.marketContext, source: 'rules' },
    historicalEdge: historicalEdgeComponent(i.historical),
    personalEdge: i.personal ? { value: i.personal.value, source: 'user_history', sampleSize: i.personal.sampleSize } : { value: null, source: 'user_history' },
  });
}
