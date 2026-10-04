import { getTemplate, type StrategyTemplate } from '@/data/strategyLibrary';

import { parseClock } from '@/utils/dates';
import { getInstrument } from '../instrumentEngine';
import { RTH_CLOSE, RTH_OPEN } from '../marketTime';

import { bracket, breakoutStrength, detectRetestHold, mapChecklist } from './core';
import type { EvaluationInput, SetupFeatures, SetupLevel, SetupSignal, StrategyEvaluator } from './types';

/**
 * Evaluators derived from Strategy Library templates. Parameters (entry
 * window, R:R, checklist wording, max trades) come from the template, so the
 * library stays the single source of strategy knowledge.
 */

function template(id: string): StrategyTemplate {
  const t = getTemplate(id);
  if (!t) throw new Error(`Unknown strategy template ${id}`);
  return t;
}

function windowOf(t: StrategyTemplate): [number, number] {
  const s = parseClock(t.defaults.entryWindowStart);
  const e = parseClock(t.defaults.entryWindowEnd);
  return [s ?? RTH_OPEN, e ?? RTH_CLOSE - 60];
}

export function setupFeatures(input: EvaluationInput, entry: number, retestNumber: number, strength: SetupFeatures['breakoutStrength'], orbSize: number | null): SetupFeatures {
  const c = input.context;
  const atr = c.atr;
  const close = input.bars[input.bars.length - 1].close;
  return {
    timeOfDayMinutes: c.minutes,
    session: c.session,
    trend: c.trend,
    orbSize,
    orbSizeAtr: orbSize != null && atr ? orbSize / atr : null,
    relativeVolume: c.relativeVolume,
    vwapDistanceAtr: c.vwap != null && atr ? (entry - c.vwap) / atr : null,
    atr,
    atrPct: atr ? (atr / close) * 100 : null,
    pdRelation: !c.prevDay ? 'unknown' : close > c.prevDay.high ? 'above_pdh' : close < c.prevDay.low ? 'below_pdl' : 'inside',
    gapPct: c.gapPct,
    retestNumber,
    breakoutStrength: strength,
  };
}

const biasAligned = (input: EvaluationInput, dir: 'long' | 'short') => {
  const c = input.context;
  const close = input.bars[input.bars.length - 1].close;
  if (dir === 'long') return c.trend === 'up' || (c.trend === 'flat' && (!c.prevDay || close > c.prevDay.close));
  return c.trend === 'down' || (c.trend === 'flat' && (!c.prevDay || close < c.prevDay.close));
};

/** Opening-range breakout + retest (orb-5 / orb-15 / orb-30). */
function orbEvaluator(strategyId: string, orMinutes: number): StrategyEvaluator {
  const t = template(strategyId);
  const [wStart, wEnd] = windowOf(t);
  return {
    strategyId,
    version: `${strategyId}@1`,
    activeWindow: [wStart, wEnd],
    lookbackSessions: 2,
    evaluate(input) {
      const c = input.context;
      if (c.minutes < wStart || c.minutes > wEnd) return null;
      const or = c.openingRange(orMinutes);
      if (!or || or.high <= or.low) return null;
      const orSize = or.high - or.low;
      const tol = Math.max(getInstrument(input.instrument).tickSize * 2, orSize * 0.1);
      for (const dir of ['long', 'short'] as const) {
        const level = dir === 'long' ? or.high : or.low;
        const d = detectRetestHold(input.bars, or.endIndex + 1, () => level, dir, tol);
        if (!d) continue;
        const entry = input.bars[input.bars.length - 1].close;
        const { stop, target } = bracket(input.instrument, dir, entry, d.retestExtreme, t.defaultRiskReward);
        const strength = breakoutStrength(Math.abs(d.breakoutClose - level), c.atr);
        const aligned = biasAligned(input, dir);
        const notExtended = Math.abs(entry - level) <= Math.max(orSize * 0.5, (c.atr ?? orSize) * 1);
        const firstRetest = d.retestNumber === 1;
        const timely = d.barsSinceBreakout <= 8;
        const checks = mapChecklist(t.checklist, [
          { match: /(range|ORB).*(marked|established)|ORB established|range marked/i, passed: true, detail: `${orMinutes}-minute range ${orSize.toFixed(2)} pts` },
          { match: /bias|HTF/i, passed: aligned, detail: aligned ? `${dir === 'long' ? 'Bullish' : 'Bearish'} context` : 'Bias does not support this direction' },
          { match: /closed? outside|close outside|candle closed/i, passed: true, detail: 'Breakout candle closed beyond the range' },
          { match: /breakout confirmed|confirmed close|range broken/i, passed: strength !== 'weak', detail: `${strength} breakout` },
          { match: /retest/i, passed: firstRetest && timely, detail: firstRetest ? (timely ? 'First retest held' : 'Retest came late') : `Retest #${d.retestNumber}` },
          { match: /extended/i, passed: notExtended, detail: notExtended ? 'Entry close to the level' : 'Entry extended from the level' },
          { match: /volume/i, passed: (c.relativeVolume ?? 1) >= 1, detail: c.relativeVolume != null ? `Relative volume ${c.relativeVolume.toFixed(2)}×` : undefined },
          { match: /window/i, passed: true },
        ]);
        const levels: SetupLevel[] = [
          { label: 'OR High', price: or.high, kind: 'orb_high' },
          { label: 'OR Low', price: or.low, kind: 'orb_low' },
        ];
        return {
          strategyId,
          strategyVersion: this.version,
          direction: dir,
          valid: checks.every((x) => x.passed),
          decisionIndex: input.bars.length - 1,
          decisionTimestamp: input.bars[input.bars.length - 1].timestamp,
          entry,
          stop,
          target,
          riskReward: t.defaultRiskReward,
          checks,
          levels,
          features: setupFeatures(input, entry, d.retestNumber, strength, orSize),
        } satisfies SetupSignal;
      }
      return null;
    },
  };
}

/** Previous-day high breakout / low breakdown with acceptance and retest. */
function previousDayEvaluator(strategyId: 'pdh-breakout' | 'pdl-breakdown'): StrategyEvaluator {
  const t = template(strategyId);
  const dir = strategyId === 'pdh-breakout' ? 'long' : 'short';
  const [wStart, wEnd] = windowOf(t);
  return {
    strategyId,
    version: `${strategyId}@1`,
    activeWindow: [Math.max(wStart, RTH_OPEN + 15), Math.min(wEnd, RTH_CLOSE - 60)],
    lookbackSessions: 2,
    evaluate(input) {
      const c = input.context;
      if (!c.prevDay || c.minutes < Math.max(wStart, RTH_OPEN + 15) || c.minutes > Math.min(wEnd, RTH_CLOSE - 60)) return null;
      const level = dir === 'long' ? c.prevDay.high : c.prevDay.low;
      // A gap beyond the level at the open is a different setup.
      const first = input.bars[c.sessionStartIndex];
      if ((dir === 'long' ? first.open > level : first.open < level)) return null;
      const tol = Math.max(getInstrument(input.instrument).tickSize * 2, (c.atr ?? 0) * 0.15);
      const d = detectRetestHold(input.bars, c.sessionStartIndex, () => level, dir, tol);
      if (!d) return null;
      const entry = input.bars[input.bars.length - 1].close;
      const { stop, target } = bracket(input.instrument, dir, entry, d.retestExtreme, t.defaultRiskReward);
      const strength = breakoutStrength(Math.abs(d.breakoutClose - level), c.atr);
      const accepted = d.closesBeyondBeforeRetest >= 2;
      const firstRetest = d.retestNumber === 1;
      const aligned = biasAligned(input, dir);
      const checks = mapChecklist(t.checklist, [
        { match: /marked/i, passed: true, detail: `${dir === 'long' ? 'PDH' : 'PDL'} ${level}` },
        { match: /break (above|below)/i, passed: true },
        { match: /acceptance/i, passed: accepted, detail: accepted ? `${d.closesBeyondBeforeRetest} closes beyond the level` : 'Only one close beyond the level' },
        { match: /retest|continuation/i, passed: firstRetest && aligned, detail: !aligned ? 'Context does not support the break' : firstRetest ? 'First retest held' : `Retest #${d.retestNumber}` },
      ]);
      return {
        strategyId,
        strategyVersion: this.version,
        direction: dir,
        valid: checks.every((x) => x.passed),
        decisionIndex: input.bars.length - 1,
        decisionTimestamp: input.bars[input.bars.length - 1].timestamp,
        entry,
        stop,
        target,
        riskReward: t.defaultRiskReward,
        checks,
        levels: [dir === 'long' ? { label: 'Previous day high', price: level, kind: 'pdh' } : { label: 'Previous day low', price: level, kind: 'pdl' }],
        features: setupFeatures(input, entry, d.retestNumber, strength, null),
      };
    },
  };
}

/** VWAP reclaim: trade through VWAP, reclaim with a close, retest that holds. */
function vwapReclaimEvaluator(): StrategyEvaluator {
  const t = template('vwap-reclaim');
  const [wStart, wEnd] = windowOf(t);
  return {
    strategyId: 'vwap-reclaim',
    version: 'vwap-reclaim@1',
    activeWindow: [wStart, wEnd],
    lookbackSessions: 2,
    evaluate(input) {
      const c = input.context;
      if (c.minutes < wStart || c.minutes > wEnd || c.vwapSeries.length < 6) return null;
      const off = c.sessionStartIndex;
      const vwapAt = (i: number) => c.vwapSeries[Math.max(0, i - off)];
      const tol = Math.max(getInstrument(input.instrument).tickSize * 2, (c.atr ?? 0) * 0.15);
      for (const dir of ['long', 'short'] as const) {
        // Find the most recent run of ≥3 closes on the opposite side of VWAP.
        let runEnd = -1;
        let run = 0;
        for (let i = off; i < input.bars.length - 1; i++) {
          const opposite = dir === 'long' ? input.bars[i].close < vwapAt(i) : input.bars[i].close > vwapAt(i);
          run = opposite ? run + 1 : 0;
          if (run >= 3) runEnd = i;
        }
        if (runEnd < 0) continue;
        const d = detectRetestHold(input.bars, runEnd + 1, vwapAt, dir, tol);
        if (!d) continue;
        const entry = input.bars[input.bars.length - 1].close;
        const { stop, target } = bracket(input.instrument, dir, entry, d.retestExtreme, t.defaultRiskReward);
        const strength = breakoutStrength(Math.abs(d.breakoutClose - vwapAt(d.breakoutIndex)), c.atr);
        const checks = mapChecklist(t.checklist, [
          { match: /through VWAP/i, passed: true, detail: `${run >= 3 ? 'Sustained' : 'Brief'} move ${dir === 'long' ? 'below' : 'above'} VWAP` },
          { match: /reclaim/i, passed: strength !== 'weak', detail: `${strength} reclaim close` },
          { match: /retest|held/i, passed: d.retestNumber === 1, detail: d.retestNumber === 1 ? 'First retest held' : `Retest #${d.retestNumber}` },
        ]);
        return {
          strategyId: 'vwap-reclaim',
          strategyVersion: this.version,
          direction: dir,
          valid: checks.every((x) => x.passed),
          decisionIndex: input.bars.length - 1,
          decisionTimestamp: input.bars[input.bars.length - 1].timestamp,
          entry,
          stop,
          target,
          riskReward: t.defaultRiskReward,
          checks,
          levels: [],
          features: setupFeatures(input, entry, d.retestNumber, strength, null),
        };
      }
      return null;
    },
  };
}

export const STRATEGY_EVALUATORS: Record<string, StrategyEvaluator> = {
  'orb-5': orbEvaluator('orb-5', 5),
  'orb-15': orbEvaluator('orb-15', 15),
  'orb-30': orbEvaluator('orb-30', 30),
  'pdh-breakout': previousDayEvaluator('pdh-breakout'),
  'pdl-breakdown': previousDayEvaluator('pdl-breakdown'),
  'vwap-reclaim': vwapReclaimEvaluator(),
};

export const hasEvaluator = (strategyId: string) => strategyId in STRATEGY_EVALUATORS;
export const getEvaluator = (strategyId: string): StrategyEvaluator | undefined => STRATEGY_EVALUATORS[strategyId];
