/**
 * Provider-independent market-data contract.
 *
 * Every source (Databento, CME DataMine, Polygon, broker feeds, CSV imports,
 * the mock generator…) implements MarketDataProvider and returns
 * NormalizedBar[]. Nothing else in Prop Guard knows which source produced a bar.
 */

export type Timeframe = '1m' | '5m' | '15m' | '1h';

export const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h'];
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 };

/** One OHLCV bar. `timestamp` is the bar OPEN time, ISO-8601 UTC. */
export interface NormalizedBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Prop Guard root symbol (ES, MES, NQ…). */
  instrument: string;
  timeframe: Timeframe;
  /** Provider id that produced the bar (e.g. "databento", "mock", "csv:my-file"). */
  source: string;
  /** Actual contract traded in this bar when known (e.g. ESM5). */
  contractSymbol?: string | null;
  /** Continuous series the bar belongs to (e.g. ES.v.0). */
  continuousSymbol?: string | null;
}

export interface HistoricalBarRequest {
  instrument: string;
  /** Inclusive start (ISO string or Date). */
  startTime: string | Date;
  /** Exclusive end (ISO string or Date). */
  endTime: string | Date;
  timeframe: Timeframe;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly displayName: string;
  /**
   * True only when bars are real recorded market data from a licensed source.
   * Mock/generated data is NEVER verified.
   */
  readonly verified: boolean;
  /** True when the provider must run server-side (credentials, licensing). */
  readonly serverOnly: boolean;
  supports(instrument: string, timeframe: Timeframe): boolean;
  getHistoricalBars(request: HistoricalBarRequest): Promise<NormalizedBar[]>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'auth' | 'rate_limited' | 'provider' | 'network' | 'parse' | 'client_runtime',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

export const toIso = (t: string | Date) => (t instanceof Date ? t.toISOString() : new Date(t).toISOString());
