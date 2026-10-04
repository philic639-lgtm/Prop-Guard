import { getInstrument, roundToTick } from '../instrumentEngine';

import type { OhlcvBar } from './types';

export interface RetestDetection {
  breakoutIndex: number;
  /** Number of distinct retest touches, including the trigger bar. */
  retestNumber: number;
  /** Most extreme price reached during the retests (stop reference). */
  retestExtreme: number;
  /** Closes beyond the level before the first retest (acceptance). */
  closesBeyondBeforeRetest: number;
  barsSinceBreakout: number;
  breakoutClose: number;
}

/**
 * Breakout → retest → hold, evaluated on the LAST bar only.
 * Returns a detection when the last bar is a hold candle: it touched the
 * broken level (within tolerance) and closed back on the breakout side.
 * Returns null if there was no breakout, the breakout failed (a close back
 * through the level), or the last bar is not a hold.
 */
export function detectRetestHold(
  bars: readonly OhlcvBar[],
  fromIndex: number,
  levelAt: (i: number) => number,
  direction: 'long' | 'short',
  tolerance: number,
): RetestDetection | null {
  const last = bars.length - 1;
  if (fromIndex >= last) return null;
  const s = direction === 'long' ? 1 : -1;
  const beyond = (price: number, i: number) => s * (price - levelAt(i)) > 0;
  const touches = (b: OhlcvBar, i: number) => (direction === 'long' ? b.low <= levelAt(i) + tolerance : b.high >= levelAt(i) - tolerance);

  let breakout = -1;
  for (let i = fromIndex; i < last; i++) {
    if (beyond(bars[i].close, i)) {
      breakout = i;
      break;
    }
  }
  if (breakout < 0) return null;

  let retests = 0;
  let acceptance = 0;
  let extreme = direction === 'long' ? Infinity : -Infinity;
  for (let i = breakout + 1; i <= last; i++) {
    const b = bars[i];
    // A close back through the level means the breakout failed.
    if (!beyond(b.close, i)) return null;
    if (touches(b, i)) {
      retests++;
      extreme = direction === 'long' ? Math.min(extreme, b.low) : Math.max(extreme, b.high);
    } else if (retests === 0) acceptance++;
  }
  const lastBar = bars[last];
  const holds = touches(lastBar, last) && beyond(lastBar.close, last) && s * (lastBar.close - lastBar.open) >= 0;
  if (!holds) return null;
  return {
    breakoutIndex: breakout,
    retestNumber: retests,
    retestExtreme: extreme,
    closesBeyondBeforeRetest: acceptance + 1,
    barsSinceBreakout: last - breakout,
    breakoutClose: bars[breakout].close,
  };
}

/** Stop beyond the retest extreme by a small tick buffer, target at the template R:R. */
export function bracket(instrument: string, direction: 'long' | 'short', entry: number, extreme: number, rr: number) {
  const tick = getInstrument(instrument).tickSize;
  const s = direction === 'long' ? 1 : -1;
  const stop = roundToTick(instrument, extreme - s * tick * 2);
  const risk = Math.abs(entry - stop);
  const target = roundToTick(instrument, entry + s * risk * rr);
  return { stop, target, risk };
}

export function breakoutStrength(distance: number, atr: number | null): 'weak' | 'normal' | 'strong' {
  if (!atr) return 'normal';
  const r = distance / atr;
  return r >= 0.6 ? 'strong' : r >= 0.25 ? 'normal' : 'weak';
}

/**
 * Map evaluator facts onto the template's own checklist labels so scenarios
 * report rules exactly as the Strategy Library states them.
 */
export function mapChecklist(labels: readonly string[], facts: { match: RegExp; passed: boolean; detail?: string }[]) {
  return labels.map((label) => {
    const f = facts.find((x) => x.match.test(label));
    return f ? { label, passed: f.passed, detail: f.detail } : { label, passed: true, detail: 'Confirm visually — not evaluated from bars' };
  });
}
