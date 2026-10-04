import { getTemplate } from '@/data/strategyLibrary';
import type { HistoricalScenario, ScenarioBar } from '@/types/marketHistory';

import { computeTradeOutcome } from './historicalOutcomeEngine';
import { etParts, RTH_CLOSE, RTH_OPEN } from './marketTime';
import { getEvaluator, scanForSignals, type OhlcvBar } from './strategyEvaluators';

/**
 * Turn stored bars into practice scenarios:
 *  1. walk forward with the Strategy Library evaluator (no lookahead),
 *  2. freeze each signal at its decision bar,
 *  3. keep pre-decision and post-decision bars separately,
 *  4. compute the outcome from post-decision bars only.
 */
export interface GenerateOptions {
  instrument: string;
  timeframe: string;
  strategyId: string;
  provider: string;
  verified: boolean;
  historical: boolean;
  bars: readonly OhlcvBar[];
  /** Bars of context shown before the decision. */
  preContextBars?: number;
  /** Max bars revealed after the decision (always within the same session). */
  maxPostBars?: number;
  /** Also create WAIT scenarios from near-miss candidates. */
  includeInvalid?: boolean;
}

const strip = (b: OhlcvBar): ScenarioBar => ({ timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

export function scenarioId(provider: string, instrument: string, timeframe: string, strategyId: string, decisionTs: string): string {
  const ts = decisionTs.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase();
  return `hs-${provider}-${instrument}-${timeframe}-${strategyId}-${ts}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80);
}

/** Session VWAP for display, aligned to [from, to]. */
function displayVwap(bars: readonly OhlcvBar[], from: number, to: number): (number | null)[] {
  const out: (number | null)[] = [];
  let date = '';
  let pv = 0;
  let vol = 0;
  // Walk back to the session start so VWAP matches what traders saw.
  let start = from;
  const fromDate = etParts(bars[from].timestamp).date;
  while (start > 0 && etParts(bars[start - 1].timestamp).date === fromDate && etParts(bars[start - 1].timestamp).minutes >= RTH_OPEN) start--;
  for (let i = start; i <= to; i++) {
    const p = etParts(bars[i].timestamp);
    const rth = p.minutes >= RTH_OPEN && p.minutes < RTH_CLOSE;
    if (p.date !== date) {
      date = p.date;
      pv = 0;
      vol = 0;
    }
    let v: number | null = null;
    if (rth) {
      const b = bars[i];
      pv += ((b.high + b.low + b.close) / 3) * Math.max(b.volume, 1);
      vol += Math.max(b.volume, 1);
      v = Math.round((pv / vol) * 1e6) / 1e6;
    }
    if (i >= from) out.push(v);
  }
  return out;
}

export function generateScenariosFromBars(o: GenerateOptions): HistoricalScenario[] {
  const evaluator = getEvaluator(o.strategyId);
  if (!evaluator) throw new Error(`No evaluator for strategy "${o.strategyId}" yet.`);
  const template = getTemplate(o.strategyId);
  const bars = [...o.bars].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const signals = scanForSignals(evaluator, o.instrument, bars, {
    includeInvalid: o.includeInvalid ?? true,
    maxPerSession: Math.max(1, template?.defaults.maxTrades ?? 1),
  });
  const pre = o.preContextBars ?? 30;
  const maxPost = o.maxPostBars ?? 48;

  return signals.map((sig) => {
    const i = sig.decisionIndex;
    const day = etParts(bars[i].timestamp).date;
    // Context: same session where possible (never more than `pre` bars).
    let from = Math.max(0, i - pre);
    while (from < i && etParts(bars[from].timestamp).date !== day) from++;
    const post: OhlcvBar[] = [];
    for (let j = i + 1; j < bars.length && post.length < maxPost; j++) {
      const p = etParts(bars[j].timestamp);
      if (p.date !== day || p.minutes >= RTH_CLOSE) break;
      post.push(bars[j]);
    }
    const outcome = computeTradeOutcome(sig.decisionTimestamp, post, { direction: sig.direction, entry: sig.entry, stop: sig.stop, target: sig.target });
    const preBars = bars.slice(from, i + 1).map(strip);
    const postBars = post.map(strip);
    return {
      id: scenarioId(o.provider, o.instrument, o.timeframe, o.strategyId, sig.decisionTimestamp),
      instrument: o.instrument,
      timeframe: o.timeframe,
      strategyId: o.strategyId,
      strategyName: template?.shortName ?? o.strategyId,
      strategyVersion: sig.strategyVersion,
      provider: o.provider,
      verified: o.verified,
      historical: o.historical,
      etDate: day,
      marketSession: sig.features.session,
      scenarioStart: preBars[0].timestamp,
      decisionTimestamp: sig.decisionTimestamp,
      scenarioEnd: (postBars[postBars.length - 1] ?? preBars[preBars.length - 1]).timestamp,
      direction: sig.direction,
      valid: sig.valid,
      entry: sig.entry,
      stop: sig.stop,
      target: sig.target,
      riskReward: sig.riskReward,
      checks: sig.checks,
      levels: sig.levels,
      features: sig.features,
      preBars,
      postBars,
      vwap: displayVwap(bars, from, i + post.length),
      outcome,
    };
  });
}
