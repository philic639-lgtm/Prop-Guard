import { getInstrument, roundToTick } from '@/lib/engines/instrumentEngine';
import { etParts, etToUtcIso, etWeekdaysBetween, RTH_CLOSE, RTH_OPEN } from '@/lib/engines/marketTime';

import { aggregateBars, normalizeBars, type RawBar } from './normalize';
import type { HistoricalBarRequest, MarketDataProvider, NormalizedBar, Timeframe } from './MarketDataProvider';
import { toIso } from './MarketDataProvider';

/**
 * Deterministic SIMULATED market data for development and demos.
 *
 * Generates regular-trading-hours 1-minute bars with realistic intraday
 * structure (opening volatility, trend / range days, U-shaped volume) from a
 * seeded random walk. It is NOT market data and is never marked verified.
 */

const BASE: Record<string, { price: number; vol: number; underlying: string }> = {
  ES: { price: 6000, vol: 1.1, underlying: 'ES' },
  MES: { price: 6000, vol: 1.1, underlying: 'ES' },
  NQ: { price: 21000, vol: 5, underlying: 'NQ' },
  MNQ: { price: 21000, vol: 5, underlying: 'NQ' },
  YM: { price: 44000, vol: 9, underlying: 'YM' },
  MYM: { price: 44000, vol: 9, underlying: 'YM' },
  RTY: { price: 2250, vol: 0.6, underlying: 'RTY' },
  M2K: { price: 2250, vol: 0.6, underlying: 'RTY' },
  CL: { price: 72, vol: 0.045, underlying: 'CL' },
  MCL: { price: 72, vol: 0.045, underlying: 'CL' },
  GC: { price: 2650, vol: 0.9, underlying: 'GC' },
  MGC: { price: 2650, vol: 0.9, underlying: 'GC' },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

export interface MockProviderOptions {
  /** Restrict supported instruments (defaults to all with a mock profile). */
  instruments?: string[];
}

export class MockHistoricalProvider implements MarketDataProvider {
  readonly id = 'mock';
  readonly displayName = 'Simulated data (development)';
  readonly verified = false;
  readonly serverOnly = false;
  private readonly instruments: string[];
  private dayCache = new Map<string, NormalizedBar[]>();

  constructor(opts: MockProviderOptions = {}) {
    this.instruments = opts.instruments ?? Object.keys(BASE);
  }

  supports(instrument: string, timeframe: Timeframe): boolean {
    return this.instruments.includes(instrument) && ['1m', '5m', '15m', '1h'].includes(timeframe);
  }

  /** Closing price of the previous simulated session — makes consecutive days continuous. */
  private dayBars(instrument: string, date: string): NormalizedBar[] {
    const key = `${instrument}|${date}`;
    const hit = this.dayCache.get(key);
    if (hit) return hit;
    const profile = BASE[instrument];
    // Micro contracts track the same underlying: generate once, relabel.
    const sibling = Object.keys(BASE).find((k) => k !== instrument && BASE[k].underlying === profile.underlying && this.dayCache.has(`${k}|${date}`));
    if (sibling) {
      const bars = this.dayCache.get(`${sibling}|${date}`)!.map((b) => ({ ...b, instrument, continuousSymbol: `${instrument}.sim`, volume: instrument.startsWith('M') ? b.volume * 3 : Math.round(b.volume / 3) }));
      this.dayCache.set(key, bars);
      return bars;
    }
    const r = rng(hash(`${profile.underlying}|${date}`));
    // Day-level drift from a slow seeded walk so price levels evolve across days.
    const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
    const level = profile.price * (1 + 0.04 * Math.sin(dayIndex / 23) + 0.02 * Math.sin(dayIndex / 7.3));
    const regime = r();
    const drift = (regime < 0.35 ? 1 : regime < 0.7 ? -1 : 0) * profile.vol * (0.12 + r() * 0.12);
    const gap = gauss(r) * profile.vol * 6;
    let price = level + gap;
    const raw: RawBar[] = [];
    for (let m = RTH_OPEN; m < RTH_CLOSE; m++) {
      const sinceOpen = m - RTH_OPEN;
      const volMult = sinceOpen < 30 ? 2.2 : sinceOpen < 90 ? 1.3 : m > RTH_CLOSE - 30 ? 1.4 : 0.85;
      const pull = (level + gap - price) * (regime >= 0.7 ? 0.02 : 0.003);
      const step = drift + pull + gauss(r) * profile.vol * volMult;
      const open = price;
      const close = price + step;
      const wick = Math.abs(gauss(r)) * profile.vol * volMult * 0.6;
      const high = Math.max(open, close) + wick * r();
      const low = Math.min(open, close) - wick * r();
      price = close;
      const vol = Math.round((sinceOpen < 30 ? 2600 : m > RTH_CLOSE - 30 ? 2200 : 900) * (0.6 + r()));
      raw.push({
        timestamp: etToUtcIso(date, m),
        open: roundToTick(instrument, open),
        high: roundToTick(instrument, Math.max(high, open, close)),
        low: roundToTick(instrument, Math.min(low, open, close)),
        close: roundToTick(instrument, close),
        volume: instrument.startsWith('M') && instrument !== 'MCL' && instrument !== 'MGC' ? Math.round(vol * 3) : vol,
      });
    }
    const { bars } = normalizeBars(raw, { instrument, timeframe: '1m', source: this.id, continuousSymbol: `${instrument}.sim` });
    this.dayCache.set(key, bars);
    return bars;
  }

  async getHistoricalBars(req: HistoricalBarRequest): Promise<NormalizedBar[]> {
    return this.getHistoricalBarsSync(req);
  }

  /** Synchronous variant for on-device simulated scenarios. */
  getHistoricalBarsSync(req: HistoricalBarRequest): NormalizedBar[] {
    if (!this.supports(req.instrument, req.timeframe)) return [];
    getInstrument(req.instrument); // throws for unknown symbols
    const start = toIso(req.startTime);
    const end = toIso(req.endTime);
    const minutes: NormalizedBar[] = [];
    for (const date of etWeekdaysBetween(start, end)) minutes.push(...this.dayBars(req.instrument, date));
    const inRange = minutes.filter((b) => b.timestamp >= start && b.timestamp < end);
    return req.timeframe === '1m' ? inRange : aggregateBars(inRange, req.timeframe);
  }
}

/** ET date of a bar — exported for tests. */
export const mockBarDate = (b: NormalizedBar) => etParts(b.timestamp).date;
