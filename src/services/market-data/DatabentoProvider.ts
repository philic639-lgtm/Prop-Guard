import { aggregateBars, normalizeBars, parseCsv, type RawBar } from './normalize';
import { MarketDataError, toIso, type HistoricalBarRequest, type MarketDataProvider, type NormalizedBar, type Timeframe } from './MarketDataProvider';

/**
 * Databento Historical API provider — SERVER-SIDE ONLY.
 *
 * Uses POST {baseUrl}/v0/timeseries.get_range with HTTP Basic auth (API key
 * as the username, empty password), dataset GLBX.MDP3 (CME Globex) and
 * continuous-contract symbology (e.g. ES.v.0 = front month by volume).
 * The key is passed in by the server process (DATABENTO_API_KEY) and must
 * never be bundled into the mobile/web app.
 *
 * Native schemas are ohlcv-1m and ohlcv-1h; 5m and 15m bars are aggregated
 * from 1m so every timeframe shares one source of truth.
 */

export const DATABENTO_DEFAULT_INSTRUMENTS = ['ES', 'MES', 'NQ', 'MNQ'] as const;

export interface DatabentoOptions {
  apiKey: string;
  dataset?: string;
  baseUrl?: string;
  /** Continuous roll rule: v = volume, c = calendar, n = open interest. */
  roll?: 'v' | 'c' | 'n';
  instruments?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Tests only: allow construction outside a server runtime. */
  dangerouslyAllowClientRuntime?: boolean;
}

/** True inside a React Native or browser bundle, where secrets must never exist. */
export function isClientRuntime(): boolean {
  const nav = typeof navigator !== 'undefined' ? (navigator as { product?: string }) : undefined;
  return nav?.product === 'ReactNative' || typeof (globalThis as { document?: unknown }).document !== 'undefined';
}

/** Databento fixed-point prices are integers scaled by 1e-9 unless pretty_px is honored. */
export function parseDatabentoPrice(v: string | undefined): number {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  if (s.includes('.') || s.includes('e') || s.includes('E')) return Number(s);
  const n = Number(s);
  return Math.abs(n) >= 1e9 ? n / 1e9 : n;
}

/** Convert Databento CSV (pretty or raw) into raw bars. */
export function parseDatabentoCsv(text: string): RawBar[] {
  return parseCsv(text).map((r) => ({
    timestamp: r.ts_event ?? r.ts_recv ?? r.timestamp ?? '',
    open: parseDatabentoPrice(r.open),
    high: parseDatabentoPrice(r.high),
    low: parseDatabentoPrice(r.low),
    close: parseDatabentoPrice(r.close),
    volume: r.volume,
    contractSymbol: r.symbol || null,
  }));
}

export class DatabentoProvider implements MarketDataProvider {
  readonly id = 'databento';
  readonly displayName = 'Databento (CME Globex MDP 3.0)';
  readonly verified = true;
  readonly serverOnly = true;
  private readonly opts: Required<Omit<DatabentoOptions, 'fetchImpl' | 'dangerouslyAllowClientRuntime'>> & { fetchImpl: typeof fetch };

  constructor(options: DatabentoOptions) {
    if (!options.dangerouslyAllowClientRuntime && isClientRuntime()) {
      throw new MarketDataError('DatabentoProvider must only run server-side.', 'client_runtime');
    }
    if (!options.apiKey) throw new MarketDataError('DATABENTO_API_KEY is not set.', 'auth');
    this.opts = {
      apiKey: options.apiKey,
      dataset: options.dataset ?? 'GLBX.MDP3',
      baseUrl: (options.baseUrl ?? 'https://hist.databento.com').replace(/\/$/, ''),
      roll: options.roll ?? 'v',
      instruments: options.instruments ?? DATABENTO_DEFAULT_INSTRUMENTS,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  supports(instrument: string, timeframe: Timeframe): boolean {
    return this.opts.instruments.includes(instrument) && ['1m', '5m', '15m', '1h'].includes(timeframe);
  }

  continuousSymbol(instrument: string): string {
    return `${instrument}.${this.opts.roll}.0`;
  }

  /** Build the form body for a request (exposed for tests and auditing). */
  buildForm(req: HistoricalBarRequest): URLSearchParams {
    const native: Timeframe = req.timeframe === '1h' ? '1h' : '1m';
    return new URLSearchParams({
      dataset: this.opts.dataset,
      symbols: this.continuousSymbol(req.instrument),
      schema: native === '1h' ? 'ohlcv-1h' : 'ohlcv-1m',
      start: toIso(req.startTime),
      end: toIso(req.endTime),
      stype_in: 'continuous',
      stype_out: 'instrument_id',
      encoding: 'csv',
      pretty_px: 'true',
      pretty_ts: 'true',
      map_symbols: 'true',
    });
  }

  async getHistoricalBars(req: HistoricalBarRequest): Promise<NormalizedBar[]> {
    if (!this.supports(req.instrument, req.timeframe)) {
      throw new MarketDataError(`Databento provider is not configured for ${req.instrument} ${req.timeframe}.`, 'unsupported');
    }
    const auth = btoa(`${this.opts.apiKey}:`); // Node 18+ and Deno provide btoa
    let res: Response;
    try {
      res = await this.opts.fetchImpl(`${this.opts.baseUrl}/v0/timeseries.get_range`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/csv' },
        body: this.buildForm(req).toString(),
      });
    } catch (e) {
      throw new MarketDataError(`Databento request failed: ${(e as Error).message}`, 'network');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const code = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : 'provider';
      throw new MarketDataError(`Databento ${res.status}: ${detail.slice(0, 300)}`, code, res.status);
    }
    const native: Timeframe = req.timeframe === '1h' ? '1h' : '1m';
    const { bars } = normalizeBars(parseDatabentoCsv(await res.text()), {
      instrument: req.instrument,
      timeframe: native,
      source: this.id,
      continuousSymbol: this.continuousSymbol(req.instrument),
      startTime: req.startTime,
      endTime: req.endTime,
    });
    return native === req.timeframe ? bars : aggregateBars(bars, req.timeframe);
  }
}
