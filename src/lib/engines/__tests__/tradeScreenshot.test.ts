import { readFileSync } from 'node:fs';

import { INSTRUMENT_CATALOG } from '@/data/instruments';

import { calculateTradeRisk } from '../riskEngine';
import { decodeImage, handleTradeScreenshot, mapInstrument, normalizeTradeReading, redact, TRADE_SCREENSHOT_SCHEMA, type HandlerDeps } from '../tradeScreenshot';

/**
 * These tests cover the DETERMINISTIC layer around the vision model:
 * validation, the "never invent" rules, misleading-annotation handling,
 * request limits and error handling. Model outputs here are SIMULATED —
 * real accuracy is measured against the deployed function with
 * `npm run trade-shot:eval` (needs OpenAI + Supabase credentials).
 */
const catalog = INSTRUMENT_CATALOG;
const F = (value: unknown, source = 'fill', confidence = 0.95, evidence = 'Fills panel') => ({ value, confidence, evidence, source });
const NONE = { value: null, confidence: 0, evidence: '', source: 'not_visible' };
const model = (over: Record<string, unknown> = {}) => ({
  screenshotType: 'completed_trade',
  legible: true,
  platform: F('Tradovate', 'fill', 0.9, 'Header'),
  instrument: F('MNQZ6'),
  direction: F('long'),
  entryPrice: F(21512.25),
  exitPrice: F(21530.75),
  stopPrice: F(21498, 'working_order', 0.9, 'Cancelled stop order'),
  targetPrice: NONE,
  quantity: F(2),
  realizedPnl: F(74, 'fill', 0.9, 'Realized P&L'),
  accountBalance: NONE,
  drawdown: NONE,
  chartLevels: [],
  notes: '',
  ...over,
});

describe('structured-output contract', () => {
  it('is a strict schema: every property required, no extra properties', () => {
    const s = TRADE_SCREENSHOT_SCHEMA.schema;
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    for (const p of Object.values(s.properties) as { type: string; required?: string[]; properties?: object; additionalProperties?: boolean }[]) {
      if (p.type === 'object') {
        expect(p.additionalProperties).toBe(false);
        expect([...(p.required ?? [])].sort()).toEqual(Object.keys(p.properties ?? {}).sort());
      }
    }
  });
});

describe('instrument mapping', () => {
  it.each([
    ['MNQZ6', 'MNQ'],
    ['ES1!', 'ES'],
    ['/MES', 'MES'],
    ['CME_MINI:NQ1!', 'NQ'],
    ['ESZ26', 'ES'],
    ['Micro E-mini Nasdaq-100', 'MNQ'],
    ['AAPL', null],
    ['', null],
  ])('%s → %s', (raw, want) => expect(mapInstrument(raw, catalog)).toBe(want));
});

describe('normalizing readings (simulated model output)', () => {
  it('Tradovate completed trade: values kept, P&L cross-check passes, nothing flagged', () => {
    const r = normalizeTradeReading(model(), catalog);
    expect(r.kind).toBe('completed_trade');
    expect(r.instrument).toMatchObject({ value: 'MNQ', raw: 'MNQZ6' });
    expect([r.entryPrice.value, r.exitPrice.value, r.stopPrice.value, r.quantity.value, r.realizedPnl.value]).toEqual([21512.25, 21530.75, 21498, 2, 74]);
    expect(r.warnings).toEqual([]);
    expect(r.usable).toBe(true);
  });

  it('open position: an "exit" (last price) is never accepted', () => {
    const r = normalizeTradeReading(model({ screenshotType: 'open_position', exitPrice: F(5008, 'position', 0.9, 'Last'), instrument: F('ESZ6'), entryPrice: F(5004.25, 'position'), realizedPnl: NONE }), catalog);
    expect(r.exitPrice.value).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/not closed/);
    expect(r.usable).toBe(true);
  });

  it('pending order: not a trade, not usable for the journal', () => {
    const r = normalizeTradeReading(model({ screenshotType: 'pending_order', instrument: F('MESZ6'), entryPrice: NONE, exitPrice: NONE, realizedPnl: NONE }), catalog);
    expect(r.usable).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/not been filled/);
  });

  it('misleading annotations: a text-note "entry" and an old "TP" are flagged, never trusted as fills', () => {
    const r = normalizeTradeReading(
      model({
        screenshotType: 'open_position',
        instrument: F('ES1!'),
        direction: F('short'),
        entryPrice: F(5050, 'text_note', 0.8, 'Text "Entry 5050?"'),
        exitPrice: NONE,
        stopPrice: F(5070, 'working_order'),
        targetPrice: F(5100, 'text_note', 0.8, 'Text "TP 5100 (last week)"'),
        realizedPnl: NONE,
      }),
      catalog,
    );
    expect(r.entryPrice.confidence).toBeLessThanOrEqual(0.45);
    expect(r.entryPrice.flags.join(' ')).toMatch(/annotation/);
    expect(r.targetPrice.flags.join(' ')).toMatch(/annotation|wrong side/);
    expect(r.targetPrice.confidence).toBeLessThanOrEqual(0.3); // above entry on a short
  });

  it('values that are unclear, unsourced or invalid become "not visible" — nothing is invented', () => {
    const r = normalizeTradeReading(
      model({
        entryPrice: F(21512.25, 'fill', 0.2),
        exitPrice: F(21530.75, 'not_visible', 0.9),
        quantity: F(1.5),
        stopPrice: F('21498'),
        realizedPnl: NONE,
      }),
      catalog,
    );
    expect(r.entryPrice.value).toBeNull();
    expect(r.exitPrice.value).toBeNull();
    expect(r.quantity.value).toBeNull();
    expect(r.stopPrice.value).toBeNull();
    expect(r.usable).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/unclear/);
  });

  it('off-tick prices and stops on the wrong side are flagged for review', () => {
    const r = normalizeTradeReading(model({ entryPrice: F(21512.3), stopPrice: F(21520, 'working_order') }), catalog);
    expect(r.entryPrice.flags.join(' ')).toMatch(/tick 0.25/);
    expect(r.stopPrice.flags.join(' ')).toMatch(/wrong side/);
  });

  it('shown P&L that disagrees with prices × contracts is reported (misread size or fees)', () => {
    const r = normalizeTradeReading(model({ quantity: F(5) }), catalog);
    expect(r.warnings.join(' ')).toMatch(/differs from the prices/);
    expect(r.quantity.confidence).toBeLessThanOrEqual(0.6);
  });

  it('chart only / dashboard / unsupported / blurry are labelled; junk output is harmless', () => {
    expect(normalizeTradeReading(model({ screenshotType: 'chart_only', exitPrice: NONE }), catalog).warnings.join(' ')).toMatch(/Chart only/);
    expect(normalizeTradeReading(model({ screenshotType: 'account_dashboard' }), catalog).warnings.join(' ')).toMatch(/Account dashboard/);
    expect(normalizeTradeReading({ screenshotType: 'nonsense' }, catalog)).toMatchObject({ kind: 'unsupported', usable: false });
    expect(normalizeTradeReading(model({ legible: false }), catalog).warnings.join(' ')).toMatch(/hard to read/);
    const junk = normalizeTradeReading('not an object', catalog);
    expect(junk.entryPrice.value).toBeNull();
    expect(junk.kind).toBe('unsupported');
  });

  it('account numbers and emails the model returns anyway are masked', () => {
    const r = normalizeTradeReading(model({ notes: 'Account APEX-123456, me@example.com', entryPrice: F(21512.25, 'fill', 0.95, 'Fills for LT-50K-284917') }), catalog);
    expect(JSON.stringify(r)).not.toMatch(/123456|284917|me@example\.com/);
    expect(redact('Account APEX-123456')).toBe('Account ••••3456');
  });

  it('confirmed values feed the deterministic risk calculation (MNQ $2/pt)', () => {
    const r = normalizeTradeReading(model({ targetPrice: F(21540, 'working_order') }), catalog);
    const risk = calculateTradeRisk({ instrument: 'MNQ', direction: 'long', entry: r.entryPrice.value, stop: r.stopPrice.value, target: r.targetPrice.value, contracts: r.quantity.value });
    expect(risk).toMatchObject({ valid: true, pointsRisk: 14.25, riskDollars: 57, rewardDollars: 111, rr: 1.95 });
  });
});

describe('edge-function request handling', () => {
  const png = readFileSync('scripts/fixtures/trade-screenshots/tradovate-completed.png', 'base64');
  const deps = (over: Partial<HandlerDeps> = {}) => {
    const log: string[] = [];
    const d: HandlerDeps = {
      configured: true,
      catalog,
      recentRequests: async () => 0,
      begin: async () => {
        log.push('begin');
        return async (status, detail) => {
          log.push(`${status}:${detail}`);
        };
      },
      callModel: async (input) => {
        log.push(`model:${input.image.mime}`);
        return model();
      },
      ...over,
    };
    return { d, log };
  };

  it('valid PNG → model called once (logged first, counted), normalized reading returned', async () => {
    const { d, log } = deps();
    const r = await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, d);
    expect(r.status).toBe(200);
    if (r.status === 200) expect(r.body.reading.instrument.value).toBe('MNQ');
    expect(log).toEqual(['begin', 'model:image/png', 'ok:completed_trade']);
    expect(log.join()).not.toContain(png.slice(0, 40));
  });

  it('not configured (no API key / model) → 503, model never called', async () => {
    const { d, log } = deps({ configured: false });
    expect((await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, d)).status).toBe(503);
    expect(log).toEqual([]);
  });

  it('image validation: wrong type, mismatched signature, tiny, oversized, not base64', async () => {
    const { d, log } = deps();
    const call = (image: unknown) => handleTradeScreenshot({ image }, d).then((r) => r.status);
    expect(await call({ base64: png, mimeType: 'image/gif' })).toBe(415);
    expect(await call({ base64: png, mimeType: 'image/jpeg' })).toBe(415); // PNG bytes declared as JPEG
    expect(await call({ base64: png.slice(0, 200), mimeType: 'image/png' })).toBe(415);
    expect(await call({ base64: 'A'.repeat(12 * 1024 * 1024), mimeType: 'image/png' })).toBe(413);
    expect(await call({ base64: '<script>', mimeType: 'image/png' })).toBe(415);
    expect(await handleTradeScreenshot({}, d).then((r) => r.status)).toBe(415);
    expect(log).toEqual([]);
    expect(decodeImage({ base64: `data:image/png;base64,${png}`, mimeType: 'image/png' })).toMatchObject({ mime: 'image/png' });
  });

  it('per-minute / hour / day limits → 429 before any model call', async () => {
    for (const window of [60_000, 3_600_000, 86_400_000]) {
      const { d, log } = deps({ recentRequests: async (ms) => (ms === window ? 1000 : 0) });
      expect((await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, d)).status).toBe(429);
      expect(log).toEqual([]);
    }
  });

  it('provider failure, timeout and malformed output → fixed error codes (no provider text)', async () => {
    const boom = deps({ callModel: async () => Promise.reject(new Error('provider_500: secret details')) });
    const r1 = await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, boom.d);
    expect(r1).toEqual({ status: 502, body: { error: 'provider_error' } });
    expect(boom.log).toEqual(['begin', 'error:provider']);

    const slow = deps({ callModel: async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) });
    expect(await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, slow.d)).toEqual({ status: 504, body: { error: 'provider_timeout' } });

    const bad = deps({ callModel: async () => 'not json' });
    expect((await handleTradeScreenshot({ image: { base64: png, mimeType: 'image/png' } }, bad.d)).status).toBe(502);
  });
});
