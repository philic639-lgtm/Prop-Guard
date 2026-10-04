import { etParts as etPartsOf, marketSessionAt, RTH_CLOSE, RTH_OPEN, type EtParts } from '../marketTime';

import type { OhlcvBar, SessionContext } from './types';

// History slices share bar objects, so ET parts can be cached per bar.
const partsCache = new WeakMap<object, EtParts>();
function etParts(b: OhlcvBar | string): EtParts {
  if (typeof b === 'string') return etPartsOf(b);
  let p = partsCache.get(b);
  if (!p) {
    p = etPartsOf(b.timestamp);
    partsCache.set(b, p);
  }
  return p;
}

/**
 * Build the session context for the LAST bar in `bars`. Only data at or
 * before that bar is read — the caller never passes future bars.
 */
export function buildSessionContext(bars: readonly OhlcvBar[]): SessionContext {
  const index = bars.length - 1;
  const now = etParts(bars[index]);
  const isRth = (b: OhlcvBar, date: string) => {
    const p = etParts(b);
    return p.date === date && p.minutes >= RTH_OPEN && p.minutes < RTH_CLOSE;
  };

  let sessionStartIndex = index;
  while (sessionStartIndex > 0 && isRth(bars[sessionStartIndex - 1], now.date)) sessionStartIndex--;
  if (!isRth(bars[sessionStartIndex], now.date)) sessionStartIndex = index;

  // Previous regular session (latest earlier ET date with RTH bars).
  let prevDay: SessionContext['prevDay'] = null;
  let prevDate: string | null = null;
  const prevDayVolumes = new Map<string, number[]>();
  for (let i = sessionStartIndex - 1; i >= 0; i--) {
    const p = etParts(bars[i]);
    if (p.date === now.date || p.minutes < RTH_OPEN || p.minutes >= RTH_CLOSE) continue;
    if (prevDate == null) prevDate = p.date;
    if (p.date === prevDate) {
      const b = bars[i];
      prevDay = prevDay
        ? { high: Math.max(prevDay.high, b.high), low: Math.min(prevDay.low, b.low), close: prevDay.close }
        : { high: b.high, low: b.low, close: b.close };
    }
    if (p.minutes <= now.minutes) {
      const list = prevDayVolumes.get(p.date) ?? [];
      list.push(bars[i].volume);
      prevDayVolumes.set(p.date, list);
    }
  }

  // VWAP of today's regular session up to now.
  const vwapSeries: number[] = [];
  let pv = 0;
  let vol = 0;
  for (let i = sessionStartIndex; i <= index; i++) {
    const b = bars[i];
    const typical = (b.high + b.low + b.close) / 3;
    const v = Math.max(b.volume, 1);
    pv += typical * v;
    vol += v;
    vwapSeries.push(pv / vol);
  }

  // ATR(14) on the bars available.
  const trs: number[] = [];
  for (let i = Math.max(1, index - 13); i <= index; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)));
  }
  const atr = trs.length ? trs.reduce((a, c) => a + c, 0) / trs.length : null;

  // Relative volume: today's cumulative volume vs the average of prior sessions at the same time.
  const todayVol = bars.slice(sessionStartIndex, index + 1).reduce((a, b) => a + b.volume, 0);
  const priorTotals = [...prevDayVolumes.values()].slice(0, 5).map((l) => l.reduce((a, c) => a + c, 0));
  const relativeVolume = priorTotals.length ? todayVol / (priorTotals.reduce((a, c) => a + c, 0) / priorTotals.length || 1) : null;

  const gapPct = prevDay ? ((bars[sessionStartIndex].open - prevDay.close) / prevDay.close) * 100 : null;
  const vwap = vwapSeries.length ? vwapSeries[vwapSeries.length - 1] : null;
  const lookback = bars.slice(Math.max(sessionStartIndex, index - 11), index + 1);
  const slope = lookback.length > 1 ? lookback[lookback.length - 1].close - lookback[0].close : 0;
  const close = bars[index].close;
  const trend: SessionContext['trend'] =
    vwap == null || atr == null ? 'flat' : close > vwap && slope > atr * 0.5 ? 'up' : close < vwap && slope < -atr * 0.5 ? 'down' : 'flat';

  const openingRange = (orMinutes: number) => {
    if (now.minutes < RTH_OPEN + orMinutes) return null;
    let high = -Infinity;
    let low = Infinity;
    let endIndex = -1;
    for (let i = sessionStartIndex; i <= index; i++) {
      const p = etParts(bars[i]);
      if (p.minutes >= RTH_OPEN + orMinutes) break;
      high = Math.max(high, bars[i].high);
      low = Math.min(low, bars[i].low);
      endIndex = i;
    }
    return endIndex >= 0 ? { high, low, endIndex } : null;
  };

  return { etDate: now.date, minutes: now.minutes, session: marketSessionAt(now.minutes), sessionStartIndex, prevDay, vwapSeries, vwap, atr, relativeVolume, gapPct, openingRange, trend };
}
