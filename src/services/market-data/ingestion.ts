import { DataCoverageService, splitRange, type CoverageRange } from './DataCoverageService';
import type { HistoricalBarStore } from './HistoricalBarStore';
import { MarketDataError, toIso, type MarketDataProvider, type Timeframe } from './MarketDataProvider';
import { normalizeBars } from './normalize';

export interface IngestRequest {
  instrument: string;
  timeframe: Timeframe;
  startDate: string | Date;
  endDate: string | Date;
}

export interface IngestDeps {
  provider: MarketDataProvider;
  store: HistoricalBarStore;
  /** Max days per provider request. */
  chunkDays?: number;
  log?: (msg: string) => void;
}

export interface IngestResult {
  requested: CoverageRange;
  alreadyCovered: boolean;
  missingRanges: CoverageRange[];
  requests: number;
  barsFetched: number;
  inserted: number;
  duplicates: number;
}

/**
 * Cost-controlled ingestion:
 *  1. check coverage, 2. compute missing ranges, 3. fetch ONLY those,
 *  4. normalize + store (duplicates ignored), 5. record coverage.
 * Re-running for an already-covered range makes zero provider requests.
 */
export async function ingestHistoricalData(req: IngestRequest, deps: IngestDeps): Promise<IngestResult> {
  const { provider, store } = deps;
  const log = deps.log ?? (() => undefined);
  if (!provider.supports(req.instrument, req.timeframe)) {
    throw new MarketDataError(`${provider.displayName} does not support ${req.instrument} ${req.timeframe}.`, 'unsupported');
  }
  const requested = { start: toIso(req.startDate), end: toIso(req.endDate) };
  const key = { instrument: req.instrument, timeframe: req.timeframe, provider: provider.id };
  const missing = await new DataCoverageService(store).missing(key, requested);
  const result: IngestResult = { requested, alreadyCovered: missing.length === 0, missingRanges: missing, requests: 0, barsFetched: 0, inserted: 0, duplicates: 0 };
  if (!missing.length) {
    log(`✓ ${req.instrument} ${req.timeframe} ${requested.start} → ${requested.end} already stored — no provider request.`);
    return result;
  }
  for (const gap of missing) {
    for (const chunk of splitRange(gap, deps.chunkDays ?? 7)) {
      log(`↓ ${provider.id} ${req.instrument} ${req.timeframe} ${chunk.start} → ${chunk.end}`);
      const fetched = await provider.getHistoricalBars({ instrument: req.instrument, timeframe: req.timeframe, startTime: chunk.start, endTime: chunk.end });
      result.requests++;
      // Re-normalize defensively: providers are trusted to normalize, the store is not optional.
      const { bars } = normalizeBars(fetched, {
        instrument: req.instrument,
        timeframe: req.timeframe,
        source: provider.id,
        continuousSymbol: fetched[0]?.continuousSymbol ?? null,
        startTime: chunk.start,
        endTime: chunk.end,
      });
      const { inserted, duplicates } = await store.upsertBars(bars);
      result.barsFetched += bars.length;
      result.inserted += inserted;
      result.duplicates += duplicates;
      await store.recordCoverage(key, chunk);
    }
  }
  log(`✓ stored ${result.inserted} new bars (${result.duplicates} duplicates skipped) in ${result.requests} request(s).`);
  return result;
}
