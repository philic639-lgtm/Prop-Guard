/**
 * Browser OCR engine (`ocr.web.ts`): model download, start-up and recognition
 * must always END — success, or a typed error with a sanitised cause — and a
 * retry must start clean. tesseract.js is replaced by a fake worker; the
 * browser by minimal globals. Timeouts run on fake timers.
 */
import { __setOcrTestHooks, OcrError, prepareOcr, recognizePrepared, sanitizeDetail, type OcrProgress } from '../accountImport/ocr.web';

jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));

type Logger = (m: { status: string; progress: number }) => void;
type Opts = { logger: Logger; errorHandler: (e: unknown) => void };

const g = globalThis as Record<string, unknown>;
const never = <T>() => new Promise<T>(() => undefined);
const DATA = { confidence: 91, blocks: [] };

/** A fetch Response whose body streams `chunks` (or never finishes when `stall`). */
function response(status: number, size = 0, opts: { stall?: boolean } = {}) {
  const chunk = new Uint8Array(200_000);
  let left = size;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h === 'content-length' ? String(size) : null) },
    body: {
      getReader: () => ({
        read: () => {
          if (opts.stall) return never();
          if (left <= 0) return Promise.resolve({ done: true, value: undefined });
          left -= chunk.byteLength;
          return Promise.resolve({ done: false, value: chunk });
        },
      }),
    },
  };
}

function fakeWorker(recognize: (o: Opts) => Promise<{ data: typeof DATA }>) {
  const terminate = jest.fn(async () => undefined);
  let opts: Opts;
  const create = jest.fn(async (_l: string, _o: number, o: Opts) => {
    opts = o;
    return { recognize: () => recognize(opts), terminate };
  });
  return { create, terminate };
}

/** Let pending promises run while fake timers are on. */
const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  g.document = { querySelector: () => null, baseURI: 'http://app.test/' };
  g.location = { origin: 'http://app.test' };
  g.fetch = jest.fn(async () => response(200, 3_000_000));
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  __setOcrTestHooks({ reset: true });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Run `p` while advancing fake time; resolves to the outcome. */
async function settle<T>(p: Promise<T>, ms = 0): Promise<{ ok: true; value: T } | { ok: false; error: OcrError }> {
  const out = p.then(
    (value) => ({ ok: true as const, value }),
    (error: OcrError) => ({ ok: false as const, error }),
  );
  await flush();
  if (ms) await jest.advanceTimersByTimeAsync(ms);
  return out;
}

describe('OCR engine start-up', () => {
  it('success: real stages in order — loading, download with real byte counts, start-up', async () => {
    const w = fakeWorker(async () => ({ data: DATA }));
    __setOcrTestHooks({ createWorker: w.create });
    const steps: OcrProgress[] = [];
    const r = await settle(prepareOcr((s) => steps.push(s)));
    expect(r.ok).toBe(true);
    expect(steps[0]).toEqual({ stage: 'loading_engine' });
    const dl = steps.filter((s) => s.stage === 'downloading_model') as Extract<OcrProgress, { stage: 'downloading_model' }>[];
    expect(dl.length).toBeGreaterThan(2);
    expect(dl.at(-1)).toEqual({ stage: 'downloading_model', received: 3_000_000, total: 3_000_000 });
    expect(steps.at(-1)).toEqual({ stage: 'starting_engine' });
    expect(w.create).toHaveBeenCalledTimes(1);
  });

  it('blocked model download (offline / CSP / CORS) → load_blocked at once, engine never started', async () => {
    g.fetch = jest.fn(async () => Promise.reject(new TypeError('Failed to fetch https://cdn.example/eng.traineddata.gz')));
    const w = fakeWorker(async () => ({ data: DATA }));
    __setOcrTestHooks({ createWorker: w.create });
    const r = await settle(prepareOcr());
    expect(r).toMatchObject({ ok: false, error: { code: 'load_blocked', detail: 'TypeError: Failed to fetch [url]' } });
    expect(w.create).not.toHaveBeenCalled();
  });

  it('missing model file (404, or an error page instead of the model) → load_missing', async () => {
    g.fetch = jest.fn(async () => response(404));
    expect(await settle(prepareOcr())).toMatchObject({ ok: false, error: { code: 'load_missing', detail: 'HTTP 404' } });
    __setOcrTestHooks({ reset: true });
    g.fetch = jest.fn(async () => response(200, 1_000));
    expect(await settle(prepareOcr())).toMatchObject({ ok: false, error: { code: 'load_missing' } });
  });

  it('stalled model download → load_timeout after the inactivity limit (not forever)', async () => {
    g.fetch = jest.fn(async () => response(200, 3_000_000, { stall: true }));
    expect(await settle(prepareOcr(), 32_000)).toMatchObject({ ok: false, error: { code: 'load_timeout', detail: 'no data for 30 s' } });
  });

  it('engine start-up failure that tesseract.js swallows (only errorHandler hears it) → load_failed at once', async () => {
    const create = jest.fn((_l: string, _o: number, o: Opts) => {
      setTimeout(() => o.errorHandler('Error: failed to load core from https://x.test/core.js'), 10);
      return never();
    });
    __setOcrTestHooks({ createWorker: create });
    const r = await settle(prepareOcr(), 50);
    expect(r).toMatchObject({ ok: false, error: { code: 'load_failed', detail: 'Error: failed to load core from [url]' } });
  });

  it('engine start-up that never settles and reports nothing → load_timeout at the overall limit', async () => {
    __setOcrTestHooks({ createWorker: jest.fn(() => never()) });
    expect(await settle(prepareOcr(), 92_000)).toMatchObject({ ok: false, error: { code: 'load_timeout' } });
  });

  it('retry after a failed download starts clean and succeeds', async () => {
    const w = fakeWorker(async () => ({ data: DATA }));
    __setOcrTestHooks({ createWorker: w.create });
    g.fetch = jest.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect((await settle(prepareOcr())).ok).toBe(false);
    g.fetch = jest.fn(async () => response(200, 3_000_000));
    expect((await settle(prepareOcr())).ok).toBe(true);
  });
});

describe('recognition', () => {
  it('reports real recognition progress and returns the data', async () => {
    const w = fakeWorker(async (o) => {
      o.logger({ status: 'recognizing text', progress: 0.5 });
      return { data: DATA };
    });
    __setOcrTestHooks({ createWorker: w.create });
    const steps: OcrProgress[] = [];
    const r = await settle(recognizePrepared({}, (s) => steps.push(s)));
    expect(r).toEqual({ ok: true, value: DATA });
    expect(steps).toContainEqual({ stage: 'recognizing', fraction: 0.5 });
  });

  it('stalled worker → read_timeout after 30 s without progress; the stuck worker is dropped and a retry uses a new one', async () => {
    let calls = 0;
    const w = fakeWorker(async () => (calls++ === 0 ? never() : { data: DATA }));
    __setOcrTestHooks({ createWorker: w.create });
    expect(await settle(recognizePrepared({}), 32_000)).toMatchObject({ ok: false, error: { code: 'read_timeout', detail: 'no progress for 30 s' } });
    expect(w.terminate).toHaveBeenCalled();
    expect(await settle(recognizePrepared({}))).toEqual({ ok: true, value: DATA });
    expect(w.create).toHaveBeenCalledTimes(2);
  });

  it('a worker that keeps reporting progress but never finishes → read_timeout at the overall limit', async () => {
    const w = fakeWorker(
      (o) =>
        new Promise(() => {
          setInterval(() => o.logger({ status: 'recognizing text', progress: 0.1 }), 5_000);
        }),
    );
    __setOcrTestHooks({ createWorker: w.create });
    expect(await settle(recognizePrepared({}), 92_000)).toMatchObject({ ok: false, error: { code: 'read_timeout', detail: 'not finished after 90 s' } });
  });

  it('a crash during recognition → read_failed (not a hang)', async () => {
    const w = fakeWorker(async () => Promise.reject(new Error('RuntimeError: memory access out of bounds')));
    __setOcrTestHooks({ createWorker: w.create });
    expect(await settle(recognizePrepared({}))).toMatchObject({ ok: false, error: { code: 'read_failed', detail: 'Error: RuntimeError: memory access out of bounds' } });
  });
});

describe('sanitizeDetail', () => {
  it('removes URLs, emails and account-like numbers; caps the length', () => {
    expect(sanitizeDetail(new TypeError('Failed to fetch https://cdn.x/eng.gz?token=abc'))).toBe('TypeError: Failed to fetch [url]');
    expect(sanitizeDetail('user me@example.com account 12345678')).toBe('user [email] account [number]');
    expect(sanitizeDetail('x'.repeat(500))!.length).toBe(160);
    expect(sanitizeDetail(null)).toBeNull();
  });
});
