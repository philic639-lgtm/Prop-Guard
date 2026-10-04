import type { CoverageKey, CoverageRange, CoverageSource } from './DataCoverageService';
import { mergeRanges } from './DataCoverageService';
import type { NormalizedBar, Timeframe } from './MarketDataProvider';
import { barKey } from './normalize';

/** Persistent cache of normalized bars + fetched coverage. */
export interface HistoricalBarStore extends CoverageSource {
  /** Insert bars; existing (instrument, timeframe, provider, timestamp) rows are kept, never duplicated. */
  upsertBars(bars: readonly NormalizedBar[]): Promise<{ inserted: number; duplicates: number }>;
  recordCoverage(key: CoverageKey, range: CoverageRange): Promise<void>;
  getBars(q: { instrument: string; timeframe: Timeframe; start: string; end: string; provider?: string }): Promise<NormalizedBar[]>;
}

/** In-memory store for tests, development and on-device simulation. */
export class InMemoryBarStore implements HistoricalBarStore {
  private bars = new Map<string, NormalizedBar>();
  private coverage = new Map<string, CoverageRange[]>();

  private ck = (k: CoverageKey) => `${k.instrument}|${k.timeframe}|${k.provider}`;

  async upsertBars(bars: readonly NormalizedBar[]) {
    let inserted = 0;
    let duplicates = 0;
    for (const b of bars) {
      const k = barKey(b);
      if (this.bars.has(k)) duplicates++;
      else {
        this.bars.set(k, b);
        inserted++;
      }
    }
    return { inserted, duplicates };
  }

  async recordCoverage(key: CoverageKey, range: CoverageRange) {
    this.coverage.set(this.ck(key), mergeRanges([...(this.coverage.get(this.ck(key)) ?? []), range]));
  }

  async getCoverage(key: CoverageKey) {
    return this.coverage.get(this.ck(key)) ?? [];
  }

  async getBars(q: { instrument: string; timeframe: Timeframe; start: string; end: string; provider?: string }) {
    return [...this.bars.values()]
      .filter((b) => b.instrument === q.instrument && b.timeframe === q.timeframe && (!q.provider || b.source === q.provider) && b.timestamp >= q.start && b.timestamp < q.end)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /** Test helper. */
  size() {
    return this.bars.size;
  }
}
