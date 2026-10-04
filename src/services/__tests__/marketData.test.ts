import {
  aggregateBars,
  computeMissingRanges,
  createServerMarketDataProvider,
  CSVHistoricalProvider,
  DataCoverageService,
  ingestHistoricalData,
  InMemoryBarStore,
  MarketDataError,
  MockHistoricalProvider,
  normalizeBars,
  parseTimestamp,
  type HistoricalBarRequest,
  type MarketDataProvider,
  type NormalizedBar,
} from '@/services/market-data';
import { DatabentoProvider, parseDatabentoCsv, parseDatabentoPrice } from '@/services/market-data/DatabentoProvider';

const META = { instrument: 'ES', timeframe: '1m' as const, source: 'test' };

describe('provider normalization', () => {
  it('parses ISO, epoch ms, epoch seconds and nanosecond timestamps to the same instant', () => {
    const iso = '2025-03-03T14:30:00.000Z';
    const ms = Date.parse(iso);
    expect(parseTimestamp(iso)).toBe(iso);
    expect(parseTimestamp(ms)).toBe(iso);
    expect(parseTimestamp(ms / 1000)).toBe(iso);
    expect(parseTimestamp(String(ms * 1e6))).toBe(iso);
    expect(parseTimestamp('not a date')).toBeNull();
  });

  it('returns the normalized bar shape and coerces strings to numbers', () => {
    const { bars } = normalizeBars([{ timestamp: '2025-03-03T14:30:00Z', open: '5000.25', high: '5001', low: '4999.5', close: '5000.75', volume: '120' }], { ...META, continuousSymbol: 'ES.v.0' });
    expect(bars).toEqual([
      {
        timestamp: '2025-03-03T14:30:00.000Z',
        open: 5000.25,
        high: 5001,
        low: 4999.5,
        close: 5000.75,
        volume: 120,
        instrument: 'ES',
        timeframe: '1m',
        source: 'test',
        contractSymbol: null,
        continuousSymbol: 'ES.v.0',
      },
    ]);
  });

  it('rejects invalid bars instead of patching them, and sorts the output', () => {
    const r = normalizeBars(
      [
        { timestamp: '2025-03-03T14:32:00Z', open: 1, high: 2, low: 0.5, close: 1.5 },
        { timestamp: '2025-03-03T14:31:00Z', open: 1, high: 0.9, low: 1, close: 1 }, // high < low
        { timestamp: '2025-03-03T14:30:00Z', open: 3, high: 2, low: 1, close: 1.5 }, // open above high
        { timestamp: 'garbage', open: 1, high: 2, low: 0.5, close: 1 },
        { timestamp: '2025-03-03T14:29:00Z', open: 1, high: 2, low: 0.5, close: 1 },
      ],
      META,
    );
    expect(r.rejected).toBe(3);
    expect(r.bars.map((b) => b.timestamp)).toEqual(['2025-03-03T14:29:00.000Z', '2025-03-03T14:32:00.000Z']);
  });

  it('filters to the requested [start, end) range', () => {
    const raw = [0, 1, 2, 3].map((i) => ({ timestamp: Date.parse('2025-03-03T14:30:00Z') + i * 60_000, open: 10, high: 11, low: 9, close: 10 }));
    const { bars } = normalizeBars(raw, { ...META, startTime: '2025-03-03T14:31:00Z', endTime: '2025-03-03T14:33:00Z' });
    expect(bars).toHaveLength(2);
  });

  it('aggregates 1m bars into UTC-aligned 5m bars', () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({ timestamp: Date.parse('2025-03-03T14:30:00Z') + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 }));
    const out = aggregateBars(normalizeBars(raw, META).bars, '5m');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ timestamp: '2025-03-03T14:30:00.000Z', open: 100, high: 105, low: 99, close: 104.5, volume: 50, timeframe: '5m' });
    expect(out[1]).toMatchObject({ timestamp: '2025-03-03T14:35:00.000Z', open: 105, close: 109.5 });
  });

  it('mock provider bars are normalized and labelled unverified', async () => {
    const mock = new MockHistoricalProvider({ instruments: ['ES'] });
    expect(mock.verified).toBe(false);
    const bars = await mock.getHistoricalBars({ instrument: 'ES', timeframe: '5m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-04T00:00:00Z' });
    expect(bars.length).toBeGreaterThan(70);
    for (const b of bars) {
      expect(b).toMatchObject({ instrument: 'ES', timeframe: '5m', source: 'mock' });
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
    // Deterministic: same request, same bars.
    expect(await mock.getHistoricalBars({ instrument: 'ES', timeframe: '5m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-04T00:00:00Z' })).toEqual(bars);
  });

  it('CSV provider normalizes imported rows and carries the caller-provided verified flag', async () => {
    const csv = 'timestamp,open,high,low,close,volume\n2025-03-03T14:30:00Z,10,11,9,10.5,5\n2025-03-03T14:31:00Z,10.5,12,10,11,7\n';
    const p = new CSVHistoricalProvider({ id: 'import1', verified: false, datasets: [{ instrument: 'ES', timeframe: '1m', csv }] });
    expect(p.id).toBe('csv:import1');
    expect(p.verified).toBe(false);
    const bars = await p.getHistoricalBars({ instrument: 'ES', timeframe: '1m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-04T00:00:00Z' });
    expect(bars.map((b) => [b.close, b.source])).toEqual([
      [10.5, 'csv:import1'],
      [11, 'csv:import1'],
    ]);
  });
});

describe('Databento provider (server-side, mocked HTTP)', () => {
  it('parses pretty and fixed-point (1e-9) prices', () => {
    expect(parseDatabentoPrice('5012.25')).toBe(5012.25);
    expect(parseDatabentoPrice('5012250000000')).toBe(5012.25);
    expect(Number.isNaN(parseDatabentoPrice(''))).toBe(true);
  });

  it('parses Databento CSV with nanosecond or ISO timestamps', () => {
    const raw = parseDatabentoCsv(
      'ts_event,rtype,publisher_id,instrument_id,open,high,low,close,volume,symbol\n' +
        '1741012200000000000,33,1,123,5012250000000,5013000000000,5011500000000,5012750000000,321,ESH5\n' +
        '2025-03-03T14:31:00.000000000Z,33,1,123,5012.75,5014.00,5012.50,5013.25,210,ESH5\n',
    );
    const { bars } = normalizeBars(raw, { instrument: 'ES', timeframe: '1m', source: 'databento' });
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ timestamp: '2025-03-03T14:30:00.000Z', open: 5012.25, high: 5013, low: 5011.5, close: 5012.75, volume: 321, contractSymbol: 'ESH5' });
    expect(bars[1]).toMatchObject({ timestamp: '2025-03-03T14:31:00.000Z', close: 5013.25 });
  });

  it('builds a continuous-contract request and normalizes the response', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const rows = Array.from({ length: 10 }, (_, i) => `${(Date.parse('2025-03-03T14:30:00Z') + i * 60_000) * 1e6},5000.00,5001.00,4999.00,5000.50,10,ESH5`);
      return new Response(`ts_event,open,high,low,close,volume,symbol\n${rows.join('\n')}\n`, { status: 200 });
    }) as unknown as typeof fetch;
    const p = new DatabentoProvider({ apiKey: 'db-test-key', fetchImpl, dangerouslyAllowClientRuntime: true });
    const req: HistoricalBarRequest = { instrument: 'ES', timeframe: '5m', startTime: '2025-03-03T14:30:00Z', endTime: '2025-03-03T14:40:00Z' };
    const bars = await p.getHistoricalBars(req);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hist.databento.com/v0/timeseries.get_range');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('db-test-key:')}`);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('dataset')).toBe('GLBX.MDP3');
    expect(form.get('symbols')).toBe('ES.v.0');
    expect(form.get('stype_in')).toBe('continuous');
    expect(form.get('schema')).toBe('ohlcv-1m'); // 5m is aggregated from 1m
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ timeframe: '5m', source: 'databento', continuousSymbol: 'ES.v.0', volume: 50 });
  });

  it('maps HTTP errors to typed errors', async () => {
    const fetchImpl = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const p = new DatabentoProvider({ apiKey: 'x', fetchImpl, dangerouslyAllowClientRuntime: true });
    await expect(p.getHistoricalBars({ instrument: 'ES', timeframe: '1m', startTime: '2025-03-03T00:00:00Z', endTime: '2025-03-04T00:00:00Z' })).rejects.toMatchObject({ code: 'auth' });
  });

  it('supports only configured instruments (ES, MES, NQ, MNQ by default)', () => {
    const p = new DatabentoProvider({ apiKey: 'x', dangerouslyAllowClientRuntime: true });
    expect(['ES', 'MES', 'NQ', 'MNQ'].every((i) => p.supports(i, '1m'))).toBe(true);
    expect(p.supports('CL', '1m')).toBe(false);
    expect(new DatabentoProvider({ apiKey: 'x', instruments: ['CL'], dangerouslyAllowClientRuntime: true }).supports('CL', '15m')).toBe(true);
  });

  it('refuses to run without a key, and refuses to run in an app (client) runtime', () => {
    expect(() => new DatabentoProvider({ apiKey: '', dangerouslyAllowClientRuntime: true })).toThrow(MarketDataError);
    const g = globalThis as { document?: unknown };
    const had = 'document' in g;
    const prev = g.document;
    g.document = {};
    try {
      expect(() => new DatabentoProvider({ apiKey: 'x' })).toThrow(/server-side/);
    } finally {
      if (had) g.document = prev;
      else delete g.document;
    }
  });

  it('server factory falls back to the unverified mock provider without a key', async () => {
    const p = await createServerMarketDataProvider({});
    expect(p.id).toBe('mock');
    expect(p.verified).toBe(false);
  });
});

const bar = (ts: string, close = 10, source = 'test'): NormalizedBar => ({
  timestamp: ts,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
  instrument: 'ES',
  timeframe: '1m',
  source,
  contractSymbol: null,
  continuousSymbol: null,
});

describe('duplicate prevention', () => {
  it('normalize de-duplicates repeated timestamps (last wins)', () => {
    const r = normalizeBars(
      [
        { timestamp: '2025-03-03T14:30:00Z', open: 10, high: 11, low: 9, close: 10 },
        { timestamp: '2025-03-03T14:30:00.000Z', open: 10, high: 12, low: 9, close: 11 },
      ],
      META,
    );
    expect(r.duplicates).toBe(1);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0].close).toBe(11);
  });

  it('the bar store never stores the same bar twice', async () => {
    const store = new InMemoryBarStore();
    const a = [bar('2025-03-03T14:30:00.000Z'), bar('2025-03-03T14:31:00.000Z')];
    expect(await store.upsertBars(a)).toEqual({ inserted: 2, duplicates: 0 });
    expect(await store.upsertBars([...a, bar('2025-03-03T14:32:00.000Z')])).toEqual({ inserted: 1, duplicates: 2 });
    expect(store.size()).toBe(3);
    // Same timestamp from a different provider is a different bar.
    expect(await store.upsertBars([bar('2025-03-03T14:30:00.000Z', 10, 'other')])).toEqual({ inserted: 1, duplicates: 0 });
  });
});

describe('data coverage and cost-controlled ingestion', () => {
  it('computes only the missing ranges', () => {
    const missing = computeMissingRanges({ start: '2025-03-01T00:00:00.000Z', end: '2025-03-10T00:00:00.000Z' }, [
      { start: '2025-03-02T00:00:00.000Z', end: '2025-03-04T00:00:00.000Z' },
      { start: '2025-03-03T00:00:00.000Z', end: '2025-03-05T00:00:00.000Z' },
      { start: '2025-03-08T00:00:00.000Z', end: '2025-03-12T00:00:00.000Z' },
    ]);
    expect(missing).toEqual([
      { start: '2025-03-01T00:00:00.000Z', end: '2025-03-02T00:00:00.000Z' },
      { start: '2025-03-05T00:00:00.000Z', end: '2025-03-08T00:00:00.000Z' },
    ]);
  });

  it('fetches only what is missing and never re-requests a stored range', async () => {
    const mock = new MockHistoricalProvider({ instruments: ['ES'] });
    const requests: HistoricalBarRequest[] = [];
    const spy: MarketDataProvider = {
      id: mock.id,
      displayName: mock.displayName,
      verified: mock.verified,
      serverOnly: false,
      supports: (i, t) => mock.supports(i, t),
      getHistoricalBars: (r) => {
        requests.push(r);
        return mock.getHistoricalBars(r);
      },
    };
    const store = new InMemoryBarStore();
    const first = await ingestHistoricalData({ instrument: 'ES', timeframe: '1m', startDate: '2025-03-03', endDate: '2025-03-05' }, { provider: spy, store });
    expect(first.requests).toBe(1);
    expect(first.inserted).toBeGreaterThan(700);
    expect(first.duplicates).toBe(0);

    const again = await ingestHistoricalData({ instrument: 'ES', timeframe: '1m', startDate: '2025-03-03', endDate: '2025-03-05' }, { provider: spy, store });
    expect(again.alreadyCovered).toBe(true);
    expect(again.requests).toBe(0);
    expect(requests).toHaveLength(1);

    // Extending the range fetches only the new day.
    const extended = await ingestHistoricalData({ instrument: 'ES', timeframe: '1m', startDate: '2025-03-03', endDate: '2025-03-06' }, { provider: spy, store });
    expect(extended.missingRanges).toEqual([{ start: '2025-03-05T00:00:00.000Z', end: '2025-03-06T00:00:00.000Z' }]);
    expect(requests[1]).toMatchObject({ startTime: '2025-03-05T00:00:00.000Z', endTime: '2025-03-06T00:00:00.000Z' });
    expect(await new DataCoverageService(store).isCovered({ instrument: 'ES', timeframe: '1m', provider: 'mock' }, { start: '2025-03-03T00:00:00.000Z', end: '2025-03-06T00:00:00.000Z' })).toBe(true);
  });

  it('records empty (closed-market) ranges as covered so they are not requested again', async () => {
    const mock = new MockHistoricalProvider({ instruments: ['ES'] });
    const store = new InMemoryBarStore();
    // 2025-03-08/09 is a weekend.
    const r = await ingestHistoricalData({ instrument: 'ES', timeframe: '1m', startDate: '2025-03-08', endDate: '2025-03-10' }, { provider: mock, store });
    expect(r.inserted).toBe(0);
    const again = await ingestHistoricalData({ instrument: 'ES', timeframe: '1m', startDate: '2025-03-08', endDate: '2025-03-10' }, { provider: mock, store });
    expect(again.requests).toBe(0);
  });

  it('rejects instruments the provider does not support', async () => {
    await expect(ingestHistoricalData({ instrument: 'ZZ', timeframe: '1m', startDate: '2025-03-03', endDate: '2025-03-04' }, { provider: new MockHistoricalProvider({ instruments: ['ES'] }), store: new InMemoryBarStore() })).rejects.toMatchObject({ code: 'unsupported' });
  });
});
