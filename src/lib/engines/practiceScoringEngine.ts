import type {
  PracticeCandle,
  PracticeDecision,
  PracticeResult,
  PracticeScenario,
  PracticeScore,
  PracticeTradeInput,
  ReplayOutcome,
} from '@/types/practice';

import { cleanNumber, findInstrument } from './instrumentEngine';

/**
 * Practice scoring and replay. Every number comes from deterministic rules
 * applied to the scenario's data and the trader's input — nothing random,
 * nothing predicted.
 */

// ---------------------------------------------------------------------------
// Trade metrics & validation
// ---------------------------------------------------------------------------

export interface PracticeTradeMetrics {
  riskPoints: number;
  rewardPoints: number;
  rr: number;
  riskTicks: number | null;
  riskDollarsPerContract: number | null;
}

export function practiceTradeMetrics(instrument: string, entry: number, stop: number, target: number): PracticeTradeMetrics {
  const spec = findInstrument(instrument);
  const riskPoints = cleanNumber(Math.abs(entry - stop), 6);
  const rewardPoints = cleanNumber(Math.abs(target - entry), 6);
  return {
    riskPoints,
    rewardPoints,
    rr: riskPoints > 0 ? cleanNumber(rewardPoints / riskPoints, 2) : 0,
    riskTicks: spec ? Math.round(riskPoints / spec.tickSize) : null,
    riskDollarsPerContract: spec ? cleanNumber(riskPoints * spec.pointValue, 2) : null,
  };
}

/** Returns an error message, or null when the levels form a valid trade for the direction. */
export function validatePracticeTrade(input: PracticeTradeInput): string | null {
  if (input.decision === 'wait') return null;
  const { entry, stop, target } = input;
  if (entry == null || stop == null || target == null || ![entry, stop, target].every((v) => Number.isFinite(v) && v > 0)) return 'Enter entry, stop and target prices.';
  if (input.decision === 'long') {
    if (stop >= entry) return 'For a long, the stop must be below the entry.';
    if (target <= entry) return 'For a long, the target must be above the entry.';
  } else {
    if (stop <= entry) return 'For a short, the stop must be above the entry.';
    if (target >= entry) return 'For a short, the target must be below the entry.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Replay simulation
// ---------------------------------------------------------------------------

/**
 * Walk the candles after the decision point and see what the trade would have done.
 * Entry fills when price trades through it (immediately if it is at/inside the
 * decision candle's close). If stop and target fall inside the same candle, the
 * stop is assumed first (conservative).
 */
export function simulatePracticeTrade(candles: readonly PracticeCandle[], decisionIndex: number, input: PracticeTradeInput): ReplayOutcome {
  const none: ReplayOutcome = { status: 'no_trade', fillIndex: null, exitIndex: null, exitPrice: null, pnlPoints: null, mfe: null, mae: null };
  if (input.decision === 'wait' || input.entry == null || input.stop == null || input.target == null) return none;
  const long = input.decision === 'long';
  const { entry, stop, target } = input;
  const ref = candles[decisionIndex]?.close ?? entry;

  let fillIndex: number | null = null;
  // Market-style fill when the entry is at the decision close; otherwise wait for price to reach it.
  if (Math.abs(ref - entry) < 1e-9) fillIndex = decisionIndex;
  let mfe = 0;
  let mae = 0;
  for (let i = decisionIndex + 1; i < candles.length; i++) {
    const k = candles[i];
    if (fillIndex == null) {
      if (k.low <= entry && k.high >= entry) fillIndex = i;
      else continue;
    }
    const fav = long ? k.high - entry : entry - k.low;
    const adv = long ? entry - k.low : k.high - entry;
    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);
    const stopHit = long ? k.low <= stop : k.high >= stop;
    const targetHit = long ? k.high >= target : k.low <= target;
    if (stopHit) return { status: 'stop', fillIndex, exitIndex: i, exitPrice: stop, pnlPoints: cleanNumber(long ? stop - entry : entry - stop, 6), mfe: cleanNumber(mfe, 6), mae: cleanNumber(mae, 6) };
    if (targetHit) return { status: 'target', fillIndex, exitIndex: i, exitPrice: target, pnlPoints: cleanNumber(long ? target - entry : entry - target, 6), mfe: cleanNumber(mfe, 6), mae: cleanNumber(mae, 6) };
  }
  if (fillIndex == null) return { ...none, status: 'not_filled' };
  const last = candles[candles.length - 1].close;
  return { status: 'expired', fillIndex, exitIndex: candles.length - 1, exitPrice: last, pnlPoints: cleanNumber(long ? last - entry : entry - last, 6), mfe: cleanNumber(mfe, 6), mae: cleanNumber(mae, 6) };
}

export function attemptResult(decision: PracticeDecision, ideal: PracticeDecision, replay: ReplayOutcome): PracticeResult {
  if (decision === 'wait') return ideal === 'wait' ? 'correct-wait' : 'incorrect-wait';
  if (replay.status === 'target') return 'win';
  if (replay.status === 'stop') return 'loss';
  if (replay.status === 'not_filled') return 'not-filled';
  return 'expired';
}

// ---------------------------------------------------------------------------
// Prop Guard Practice Score (0–100)
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS = { strategyMatch: 30, trendAlignment: 20, entryQuality: 20, riskReward: 15, timing: 15 } as const;

export function gradeFor(total: number): { grade: PracticeScore['grade']; verdict: PracticeScore['verdict'] } {
  if (total >= 90) return { grade: 'A+', verdict: 'Excellent Setup' };
  if (total >= 80) return { grade: 'A', verdict: 'Valid Setup' };
  if (total >= 70) return { grade: 'B', verdict: 'Marginal Setup' };
  if (total >= 55) return { grade: 'C', verdict: 'Low Quality' };
  return { grade: 'D', verdict: 'Avoid' };
}

const fmt = (instrument: string, v: number) => {
  const spec = findInstrument(instrument);
  return spec ? v.toFixed(Math.min(spec.priceDecimals, 4)) : String(v);
};

/**
 * Score the trader's decision against the scenario's rule-based ideal.
 * Components: strategy match (30), trend alignment (20), entry quality (20),
 * risk:reward (15), timing (15).
 */
export function scorePracticeDecision(s: PracticeScenario, input: PracticeTradeInput): PracticeScore {
  const strengths: string[] = [];
  const mistakes: string[] = [];
  const ideal = s.idealDecision;
  const d = input.decision;
  const correct = d === ideal;
  const c = { strategyMatch: 0, trendAlignment: 0, entryQuality: 0, riskReward: 0, timing: 0 };
  const ch = s.setupCharacteristics;

  // 1. Strategy match — did you read the setup correctly?
  if (correct) {
    c.strategyMatch = SCORE_WEIGHTS.strategyMatch;
    strengths.push(ideal === 'wait' ? 'Correctly stood aside — the strategy rules were not met' : `Correct read: a valid ${s.strategyName} ${ideal} setup`);
    if (ideal !== 'wait' && ch.firstRetest) strengths.push('Recognised the first retest of the level');
    if (ideal !== 'wait' && ch.breakoutStrength === 'strong') strengths.push('Breakout held successfully before entry');
  } else if (d === 'wait') {
    c.strategyMatch = 10;
    mistakes.push(`Missed a valid ${s.strategyName} ${ideal} setup — every rule was met at the decision point.`);
  } else if (ideal === 'wait') {
    c.strategyMatch = 5;
    mistakes.push(`Took a trade when the ${s.strategyName} rules said WAIT.`);
    if (ch.retestNumber && ch.retestNumber >= 3) mistakes.push(`This was retest #${ch.retestNumber} — later retests are weaker and failed here.`);
    if (ch.breakoutStrength === 'weak') mistakes.push('The breakout was weak and never showed acceptance.');
  } else {
    mistakes.push(`Traded the opposite direction — the setup was a ${ideal}.`);
  }

  // 2. Trend alignment — with the higher-timeframe bias?
  const bias = s.marketContext.higherTimeframeBias;
  if (d === 'wait') {
    c.trendAlignment = ideal === 'wait' ? SCORE_WEIGHTS.trendAlignment : 10;
  } else {
    const aligned = (bias === 'bullish' && d === 'long') || (bias === 'bearish' && d === 'short');
    const against = (bias === 'bullish' && d === 'short') || (bias === 'bearish' && d === 'long');
    c.trendAlignment = aligned ? SCORE_WEIGHTS.trendAlignment : against ? 0 : 12;
    if (aligned) strengths.push('Higher timeframe aligned');
    else if (against) mistakes.push(`Traded against the ${bias} higher-timeframe bias.`);
  }

  // 3–5. Entry quality, risk:reward and timing for trades.
  const it = s.idealTrade;
  if (d === 'wait') {
    c.entryQuality = ideal === 'wait' ? SCORE_WEIGHTS.entryQuality : 0;
    c.riskReward = ideal === 'wait' ? SCORE_WEIGHTS.riskReward : 0;
    c.timing = ideal === 'wait' ? SCORE_WEIGHTS.timing : 5;
    if (ideal === 'wait') strengths.push('Protected capital by not forcing a trade');
  } else if (input.entry != null && input.stop != null && input.target != null) {
    const m = practiceTradeMetrics(s.instrument, input.entry, input.stop, input.target);
    // Risk : reward
    c.riskReward = m.rr >= 2 ? 15 : m.rr >= 1.5 ? 11 : m.rr >= 1 ? 6 : 2;
    if (m.rr >= 2) strengths.push(`Strong risk/reward (1:${m.rr})`);
    else if (m.rr < 1) mistakes.push(`Reward was smaller than risk (1:${m.rr}).`);
    else if (m.rr < 1.5) mistakes.push(`Risk/reward of 1:${m.rr} is below the plan's minimum.`);

    if (it && d === ideal) {
      const idealRisk = Math.abs(it.entry - it.stop) || 1;
      const off = Math.abs(input.entry - it.entry) / idealRisk;
      c.entryQuality = off <= 0.1 ? 20 : off <= 0.25 ? 16 : off <= 0.5 ? 10 : off <= 1 ? 5 : 0;
      if (off <= 0.25) strengths.push('Entry near the ideal zone');
      else {
        const pts = Math.abs(input.entry - it.entry);
        const later = d === 'long' ? input.entry > it.entry : input.entry < it.entry;
        mistakes.push(`Entry was ${fmt(s.instrument, pts)} points ${later ? 'later (chasing)' : 'earlier'} than the ideal entry.`);
      }
      // Stop placement: inside the structure (too tight) or far beyond it.
      const tooTight = d === 'long' ? input.stop > it.stop + idealRisk * 0.35 : input.stop < it.stop - idealRisk * 0.35;
      if (tooTight) {
        c.entryQuality = Math.max(0, c.entryQuality - 4);
        mistakes.push('Stop was inside the structure — likely to be stopped out by normal noise.');
      } else strengths.push('Stop placed beyond the invalidation point');
      // Timing: inside the ideal entry zone?
      const [lo, hi] = s.idealEntryZone ?? [it.entry, it.entry];
      const zw = Math.max(hi - lo, idealRisk * 0.1);
      const dist = input.entry < lo ? lo - input.entry : input.entry > hi ? input.entry - hi : 0;
      c.timing = dist === 0 ? 15 : dist <= zw ? 9 : 3;
      if (dist === 0) strengths.push('Entered on the confirmation candle, not before it');
    } else {
      c.entryQuality = 0;
      c.timing = 3;
    }
  }

  const total = Math.round(Object.values(c).reduce((a, b) => a + b, 0));
  const { grade, verdict } = gradeFor(total);
  return { total, components: c, grade, verdict, correct, strengths: [...new Set(strengths)], mistakes, lesson: s.lesson };
}

// ---------------------------------------------------------------------------
// Trainer score (historical scenarios): process, not outcome
// ---------------------------------------------------------------------------

export const TRAINER_WEIGHTS = {
  direction: 20,
  entryQuality: 15,
  stopPlacement: 15,
  targetPlacement: 10,
  riskReward: 10,
  ruleAdherence: 15,
  decisionQuality: 15,
} as const;

const TRAINER_LABEL: Record<keyof typeof TRAINER_WEIGHTS, string> = {
  direction: 'Direction',
  entryQuality: 'Entry quality',
  stopPlacement: 'Stop placement',
  targetPlacement: 'Target placement',
  riskReward: 'Risk : reward',
  ruleAdherence: 'Rule adherence',
  decisionQuality: 'Decision quality',
};

/** Optional verified-history context (only used when the sample is sufficient). */
export interface TrainerHistoryContext {
  limited: boolean;
  sampleSize: number;
  typicalWinnerMAE: number | null;
  medianMFE: number | null;
}

/**
 * Grade a decision on a historical scenario across seven process components.
 * The OUTCOME IS NEVER AN INPUT: a well-executed trade that lost scores the
 * same as one that won, and a lucky winner from a bad decision scores low.
 */
export function scoreTrainerDecision(s: PracticeScenario, input: PracticeTradeInput, history?: TrainerHistoryContext | null): PracticeScore {
  const W = TRAINER_WEIGHTS;
  const c = { direction: 0, entryQuality: 0, stopPlacement: 0, targetPlacement: 0, riskReward: 0, ruleAdherence: 0, decisionQuality: 0 };
  const strengths: string[] = [];
  const mistakes: string[] = [];
  const ideal = s.idealDecision;
  const d = input.decision;
  const correct = d === ideal;
  const failed = s.historical?.checks.filter((x) => !x.passed) ?? [];
  const it = s.idealTrade;
  const useHistory = history && !history.limited;

  // Direction
  if (correct) {
    c.direction = W.direction;
    strengths.push(ideal === 'wait' ? 'Correctly skipped — the strategy rules were not all met' : `Correct direction: ${ideal.toUpperCase()}`);
  } else if (d === 'wait') {
    c.direction = 6;
    mistakes.push(`Skipped a valid ${s.strategyName} ${ideal} setup.`);
  } else if (ideal === 'wait') {
    c.direction = 4;
    mistakes.push('Took a trade the strategy rules did not support.');
  } else mistakes.push(`Traded the wrong direction — the setup was ${ideal.toUpperCase()}.`);

  // Rule adherence
  if (correct) {
    c.ruleAdherence = W.ruleAdherence;
    if (ideal !== 'wait') strengths.push('Every strategy rule was satisfied at the decision');
  } else if (d === 'wait') {
    c.ruleAdherence = 8;
  } else if (ideal === 'wait') {
    for (const f of failed.slice(0, 3)) mistakes.push(`Rule not met: ${f.label}${f.detail ? ` (${f.detail})` : ''}.`);
  }

  if (d === 'wait') {
    const full = ideal === 'wait';
    c.entryQuality = full ? W.entryQuality : 0;
    c.stopPlacement = full ? W.stopPlacement : 0;
    c.targetPlacement = full ? W.targetPlacement : 0;
    c.riskReward = full ? W.riskReward : 0;
    c.decisionQuality = full ? W.decisionQuality : 5;
    if (full) strengths.push('Protected capital by not forcing a trade');
  } else if (input.entry != null && input.stop != null && input.target != null && it) {
    const idealRisk = Math.abs(it.entry - it.stop) || 1;
    const userRisk = Math.abs(input.entry - input.stop) || Number.EPSILON;
    const userRR = Math.abs(input.target - input.entry) / userRisk;
    const long = d === 'long';

    // Entry quality
    const off = Math.abs(input.entry - it.entry) / idealRisk;
    c.entryQuality = off <= 0.1 ? 15 : off <= 0.25 ? 12 : off <= 0.5 ? 7 : off <= 1 ? 3 : 0;
    if (off <= 0.25) strengths.push('Entry at the decision price');
    else mistakes.push(`Entry was ${(off).toFixed(1)}R away from the planned entry.`);

    // Stop placement — beyond the structure (retest extreme)?
    const beyondStructure = long ? input.stop <= it.stop + idealRisk * 0.1 : input.stop >= it.stop - idealRisk * 0.1;
    const stopR = userRisk / idealRisk;
    if (!beyondStructure && stopR < 0.65) {
      c.stopPlacement = 4;
      mistakes.push('Stop was inside the structure — normal noise could stop the trade out.');
    } else if (useHistory && history.typicalWinnerMAE != null && stopR < history.typicalWinnerMAE) {
      c.stopPlacement = 7;
      mistakes.push(`Your stop was tighter than the typical pullback seen in ${history.sampleSize} similar verified setups.`);
    } else if (stopR > 2) {
      c.stopPlacement = 8;
      mistakes.push('Stop was much wider than the structure required, shrinking position size and R.');
    } else {
      c.stopPlacement = W.stopPlacement;
      strengths.push('Stop placed beyond the invalidation point');
    }

    // Target placement relative to the strategy's planned R:R (and history when available)
    const planRR = it.riskReward;
    if (Math.abs(userRR - planRR) <= 0.5) {
      c.targetPlacement = W.targetPlacement;
      strengths.push(`Target matches the plan (≈1:${planRR})`);
    } else if (useHistory && history.medianMFE != null && userRR > history.medianMFE && userRR > planRR) {
      c.targetPlacement = 5;
      mistakes.push(`Target (${userRR.toFixed(1)}R) is beyond the median favorable move of similar verified setups.`);
    } else if (userRR < 1) {
      c.targetPlacement = 2;
      mistakes.push('Target is closer than the stop.');
    } else c.targetPlacement = 6;

    // Risk : reward
    c.riskReward = userRR >= planRR ? W.riskReward : userRR >= planRR - 0.5 ? 7 : userRR >= 1 ? 4 : 0;
    if (userRR < planRR - 0.5) mistakes.push(`Risk/reward 1:${userRR.toFixed(1)} is below the strategy's 1:${planRR}.`);

    // Decision quality — the overall process
    const flaws = [!beyondStructure, userRR < 1, off > 0.5].filter(Boolean).length;
    c.decisionQuality = correct ? (flaws === 0 ? W.decisionQuality : flaws === 1 ? 9 : 4) : 0;
  }

  const total = Math.round(Object.values(c).reduce((a, b) => a + b, 0));
  const { grade, verdict } = gradeFor(total);
  return {
    total,
    components: {
      strategyMatch: Math.round(((c.direction + c.ruleAdherence) / (W.direction + W.ruleAdherence)) * SCORE_WEIGHTS.strategyMatch),
      trendAlignment: Math.round((c.decisionQuality / W.decisionQuality) * SCORE_WEIGHTS.trendAlignment),
      entryQuality: Math.round((c.entryQuality / W.entryQuality) * SCORE_WEIGHTS.entryQuality),
      riskReward: Math.round(((c.riskReward + c.targetPlacement) / (W.riskReward + W.targetPlacement)) * SCORE_WEIGHTS.riskReward),
      timing: Math.round((c.stopPlacement / W.stopPlacement) * SCORE_WEIGHTS.timing),
    },
    breakdown: (Object.keys(W) as (keyof typeof W)[]).map((k) => ({ key: k, label: TRAINER_LABEL[k], value: c[k], max: W[k] })),
    grade,
    verdict,
    correct,
    strengths: [...new Set(strengths)],
    mistakes,
    lesson: s.lesson,
  };
}
