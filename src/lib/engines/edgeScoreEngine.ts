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
