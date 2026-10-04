import type { OhlcvBar } from './strategyEvaluators/types';

/**
 * What actually happened after a decision. Uses ONLY bars after the decision
 * bar (the caller passes them explicitly), and never influences detection.
 *
 * Fill model: market entry at the decision bar's close.
 * Same-bar conflicts: if a bar's range touches both stop and target, the stop
 * is assumed first (conservative) and the outcome is flagged `ambiguous`.
 * Gaps: a bar that opens beyond the stop exits at its open (worse than stop).
 */

export interface TradePlanLevels {
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
}

export type OutcomeStatus = 'target' | 'stop' | 'open';

export interface HistoricalTradeOutcome {
  status: OutcomeStatus;
  stopHitFirst: boolean;
  targetHitFirst: boolean;
  /** Both levels inside one bar — resolved as a stop, flagged for review. */
  ambiguous: boolean;
  exitIndex: number | null;
  exitPrice: number;
  /** Max favorable / adverse excursion while the trade was open (points and R). */
  mfePoints: number;
  maePoints: number;
  mfeR: number;
  maeR: number;
  /** Highest R reached before the exit. */
  maxR: number;
  /** Best R reached at any point in the post-decision window (even after the exit). */
  bestRAfterEntry: number;
  /** R realized at exit (or marked-to-market at the window end when still open). */
  rrAchieved: number;
  timeToTargetMinutes: number | null;
  timeToStopMinutes: number | null;
  durationMinutes: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeTradeOutcome(decisionTimestamp: string, postBars: readonly OhlcvBar[], plan: TradePlanLevels): HistoricalTradeOutcome {
  const long = plan.direction === 'long';
  const risk = Math.abs(plan.entry - plan.stop) || Number.EPSILON;
  const fav = (b: OhlcvBar) => (long ? b.high - plan.entry : plan.entry - b.low);
  const adv = (b: OhlcvBar) => (long ? plan.entry - b.low : b.high - plan.entry);
  const t0 = Date.parse(decisionTimestamp);
  const minutesTo = (b: OhlcvBar) => Math.round((Date.parse(b.timestamp) - t0) / 60_000);

  let mfe = 0;
  let mae = 0;
  let best = 0;
  for (const b of postBars) best = Math.max(best, fav(b));

  for (let i = 0; i < postBars.length; i++) {
    const b = postBars[i];
    const stopHit = long ? b.low <= plan.stop : b.high >= plan.stop;
    const targetHit = long ? b.high >= plan.target : b.low <= plan.target;
    const gapThroughStop = long ? b.open <= plan.stop : b.open >= plan.stop;
    if (stopHit) {
      const exitPrice = gapThroughStop ? b.open : plan.stop;
      // Adverse excursion runs to the exit; favorable movement inside the stop bar is not credited.
      mae = Math.max(mae, Math.abs(plan.entry - exitPrice));
      const ambiguous = targetHit && !gapThroughStop;
      return finalize('stop', i, exitPrice, ambiguous, minutesTo(b));
    }
    mfe = Math.max(mfe, fav(b));
    mae = Math.max(mae, adv(b));
    if (targetHit) return finalize('target', i, plan.target, false, minutesTo(b));
  }
  const last = postBars[postBars.length - 1];
  return finalize('open', null, last ? last.close : plan.entry, false, last ? minutesTo(last) : 0);

  function finalize(status: OutcomeStatus, exitIndex: number | null, exitPrice: number, ambiguous: boolean, minutes: number): HistoricalTradeOutcome {
    const pnl = long ? exitPrice - plan.entry : plan.entry - exitPrice;
    return {
      status,
      stopHitFirst: status === 'stop',
      targetHitFirst: status === 'target',
      ambiguous,
      exitIndex,
      exitPrice,
      mfePoints: r2(Math.max(0, mfe)),
      maePoints: r2(Math.max(0, mae)),
      mfeR: r2(Math.max(0, mfe) / risk),
      maeR: r2(Math.max(0, mae) / risk),
      maxR: r2(Math.max(0, mfe) / risk),
      bestRAfterEntry: r2(Math.max(0, best) / risk),
      rrAchieved: r2(pnl / risk),
      timeToTargetMinutes: status === 'target' ? minutes : null,
      timeToStopMinutes: status === 'stop' ? minutes : null,
      durationMinutes: minutes,
    };
  }
}
