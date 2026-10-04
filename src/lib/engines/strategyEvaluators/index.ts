import { etParts } from '../marketTime';

import { buildSessionContext } from './context';
import { getEvaluator } from './evaluators';
import type { OhlcvBar, SetupSignal, StrategyEvaluator } from './types';

export * from './types';
export { buildSessionContext } from './context';
export { detectRetestHold, mapChecklist } from './core';
export { STRATEGY_EVALUATORS, getEvaluator, hasEvaluator } from './evaluators';

/**
 * Evaluate a strategy "now" on the latest bar — the entry point for a live
 * checker. `history` must end at the current bar.
 */
export function evaluateLatest(strategyId: string, instrument: string, history: readonly OhlcvBar[]): SetupSignal | null {
  const ev = getEvaluator(strategyId);
  if (!ev || !history.length) return null;
  return ev.evaluate({ instrument, bars: history, context: buildSessionContext(history) });
}

export interface ScanOptions {
  /** Prior sessions kept in each evaluation window (for previous-day levels and relative volume). */
  lookbackSessions?: number;
  /** Max signals per session (defaults to the template's max trades, min 1). */
  maxPerSession?: number;
  /** Include near-miss candidates (valid = false) for WAIT scenarios. */
  includeInvalid?: boolean;
}

/**
 * Walk forward bar by bar. At each bar the evaluator receives a COPY of the
 * history ending at that bar — future bars are never visible to detection.
 */
export function scanForSignals(evaluator: StrategyEvaluator, instrument: string, bars: readonly OhlcvBar[], opts: ScanOptions = {}): SetupSignal[] {
  const lookback = opts.lookbackSessions ?? evaluator.lookbackSessions;
  const [wStart, wEnd] = evaluator.activeWindow;
  const maxPer = opts.maxPerSession ?? 1;
  const dates = bars.map((b) => etParts(b.timestamp).date);
  const out: SetupSignal[] = [];
  const perDay = new Map<string, { valid: number; invalid: number }>();
  let windowStart = 0;
  let sessionsSeen: string[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (!sessionsSeen.length || sessionsSeen[sessionsSeen.length - 1] !== dates[i]) {
      sessionsSeen.push(dates[i]);
      if (sessionsSeen.length > lookback + 1) {
        sessionsSeen = sessionsSeen.slice(-1 - lookback);
        while (windowStart < i && dates[windowStart] !== sessionsSeen[0]) windowStart++;
      }
    }
    const day = perDay.get(dates[i]) ?? { valid: 0, invalid: 0 };
    if (day.valid >= maxPer) continue;
    const minutes = etParts(bars[i].timestamp).minutes;
    if (minutes < wStart || minutes > wEnd) continue; // cheap skip — the evaluator would return null
    const history = bars.slice(windowStart, i + 1); // ← nothing after bar i
    const sig = evaluator.evaluate({ instrument, bars: history, context: buildSessionContext(history) });
    if (!sig) continue;
    if (!sig.valid && (!opts.includeInvalid || day.invalid >= 1)) continue;
    // Re-index to the full series.
    out.push({ ...sig, decisionIndex: i });
    if (sig.valid) day.valid++;
    else day.invalid++;
    perDay.set(dates[i], day);
  }
  return out;
}
