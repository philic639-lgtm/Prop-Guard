import type { Timeframe } from './MarketDataProvider';

/**
 * Which historical ranges we already hold, so we never pay to download or
 * process the same data twice.
 *
 * Coverage is tracked per (instrument, timeframe, provider) as half-open
 * [start, end) UTC ranges that were SUCCESSFULLY fetched — including ranges
 * that legitimately contained no bars (weekends, holidays). Inferring gaps
 * from stored bars alone would re-request closed-market periods forever.
 */
export interface CoverageRange {
  start: string;
  end: string;
}

export interface CoverageKey {
  instrument: string;
  timeframe: Timeframe;
  provider: string;
}

const ms = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

/** Merge overlapping/adjacent ranges. */
export function mergeRanges(ranges: readonly CoverageRange[]): CoverageRange[] {
  const sorted = ranges.filter((r) => ms(r.end) > ms(r.start)).sort((a, b) => ms(a.start) - ms(b.start));
  const out: CoverageRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && ms(r.start) <= ms(last.end)) {
      if (ms(r.end) > ms(last.end)) last.end = r.end;
    } else out.push({ start: iso(ms(r.start)), end: iso(ms(r.end)) });
  }
  return out;
}

/** Parts of [start, end) not covered by `covered`. */
export function computeMissingRanges(requested: CoverageRange, covered: readonly CoverageRange[]): CoverageRange[] {
  const start = ms(requested.start);
  const end = ms(requested.end);
  if (!(end > start)) return [];
  const missing: CoverageRange[] = [];
  let cursor = start;
  for (const c of mergeRanges(covered)) {
    const cs = ms(c.start);
    const ce = ms(c.end);
    if (ce <= cursor) continue;
    if (cs >= end) break;
    if (cs > cursor) missing.push({ start: iso(cursor), end: iso(Math.min(cs, end)) });
    cursor = Math.max(cursor, ce);
    if (cursor >= end) break;
  }
  if (cursor < end) missing.push({ start: iso(cursor), end: iso(end) });
  return missing;
}

/** Split a range into chunks of at most `days` days (provider request sizing). */
export function splitRange(r: CoverageRange, days: number): CoverageRange[] {
  const step = days * 86_400_000;
  const out: CoverageRange[] = [];
  for (let s = ms(r.start); s < ms(r.end); s += step) out.push({ start: iso(s), end: iso(Math.min(s + step, ms(r.end))) });
  return out;
}

export interface CoverageSource {
  getCoverage(key: CoverageKey): Promise<CoverageRange[]>;
}

export class DataCoverageService {
  constructor(private readonly source: CoverageSource) {}

  async covered(key: CoverageKey): Promise<CoverageRange[]> {
    return mergeRanges(await this.source.getCoverage(key));
  }

  async missing(key: CoverageKey, requested: CoverageRange): Promise<CoverageRange[]> {
    return computeMissingRanges(requested, await this.source.getCoverage(key));
  }

  async isCovered(key: CoverageKey, requested: CoverageRange): Promise<boolean> {
    return (await this.missing(key, requested)).length === 0;
  }
}
