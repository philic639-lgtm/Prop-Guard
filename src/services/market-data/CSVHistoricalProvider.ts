import { aggregateBars, normalizeBars, parseCsv } from './normalize';
import { MarketDataError, TIMEFRAME_MINUTES, type HistoricalBarRequest, type MarketDataProvider, type NormalizedBar, type Timeframe } from './MarketDataProvider';

/**
 * Manual OHLCV imports (vendor exports, broker downloads, research datasets).
 * Expected columns (case-insensitive): timestamp|time|datetime|ts_event,
 * open, high, low, close, volume, optional symbol. Timestamps must include a
 * timezone or be UTC.
 */
export interface CsvDataset {
  instrument: string;
  /** Timeframe of the rows in the file. */
  timeframe: Timeframe;
  csv: string;
}

export interface CsvProviderOptions {
  id: string;
  datasets: CsvDataset[];
  /** Mark verified ONLY when the file is licensed, recorded market data. */
  verified: boolean;
}

export class CSVHistoricalProvider implements MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  readonly verified: boolean;
  readonly serverOnly = false;
  private readonly datasets: CsvDataset[];

  constructor(opts: CsvProviderOptions) {
    this.id = `csv:${opts.id}`;
    this.displayName = `CSV import (${opts.id})`;
    this.verified = opts.verified;
    this.datasets = opts.datasets;
  }

  private dataset(instrument: string, timeframe: Timeframe) {
    // Use the finest dataset that can be aggregated up to the requested timeframe.
    return this.datasets
      .filter((d) => d.instrument === instrument && TIMEFRAME_MINUTES[d.timeframe] <= TIMEFRAME_MINUTES[timeframe] && TIMEFRAME_MINUTES[timeframe] % TIMEFRAME_MINUTES[d.timeframe] === 0)
      .sort((a, b) => TIMEFRAME_MINUTES[b.timeframe] - TIMEFRAME_MINUTES[a.timeframe])[0];
  }

  supports(instrument: string, timeframe: Timeframe): boolean {
    return !!this.dataset(instrument, timeframe);
  }

  async getHistoricalBars(req: HistoricalBarRequest): Promise<NormalizedBar[]> {
    const ds = this.dataset(req.instrument, req.timeframe);
    if (!ds) throw new MarketDataError(`No CSV data for ${req.instrument} ${req.timeframe}.`, 'unsupported');
    const rows = parseCsv(ds.csv).map((r) => ({
      timestamp: r.timestamp ?? r.time ?? r.datetime ?? r.ts_event ?? r.date ?? '',
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      contractSymbol: r.symbol || null,
    }));
    const { bars } = normalizeBars(rows, { instrument: req.instrument, timeframe: ds.timeframe, source: this.id, startTime: req.startTime, endTime: req.endTime });
    return ds.timeframe === req.timeframe ? bars : aggregateBars(bars, req.timeframe);
  }
}
