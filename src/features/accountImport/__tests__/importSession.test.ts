/**
 * Import session (upload → read → review state): the reading state always
 * clears, failures carry a real cause, retries work, stale reads never
 * overwrite newer results, missing values stay missing — and the confirmed
 * result saves into the account.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { applyImport, confirmImport, crossCheck, mergePages, type FieldKey, type OcrPage } from '@/lib/engines/accountImport';
import lucid from '@/lib/engines/__tests__/fixtures/accountScreenshots/lucid.json';
import { OcrError, type OcrProgress } from '@/services/accountImport/ocrShared';
import { makeAccount } from '@/test/fixtures';

import { useImportSession } from '../useImportSession';

const mockRecognize = jest.fn();
jest.mock('@/services/accountImport/ocr', () => {
  const shared = jest.requireActual('@/services/accountImport/ocrShared');
  return {
    ...shared,
    recognize: (...a: unknown[]) => mockRecognize(...a),
    ocrAvailable: () => true,
    disposeOcr: async () => undefined,
    redactImage: async () => null,
  };
});
jest.mock('@/services/ai', () => ({ aiService: {} }));
jest.mock('@/services/accountImport/images', () => ({ MAX_IMAGES: 5, releaseImages: () => undefined }));

const db = FIRM_RULES_SEED;
const img = (id: string) => ({ id, uri: `blob:${id}`, name: `${id}.png`, width: 900, height: 720, type: 'image/png', bytes: 40_000 });
const S = () => useImportSession.getState();
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const linesPage = (lines: string[]): OcrPage => ({
  width: 800,
  height: lines.length * 40,
  confidence: 92,
  lines: lines.map((t, i) => {
    let x = 10;
    const words = t.split(' ').map((w) => {
      const bbox = { x0: x, y0: i * 40, x1: x + w.length * 10, y1: i * 40 + 16 };
      x += w.length * 10 + 10;
      return { text: w, confidence: 92, bbox };
    });
    return { text: t, confidence: 92, bbox: { x0: 10, y0: i * 40, x1: x, y1: i * 40 + 16 }, words };
  }),
});

beforeEach(() => {
  mockRecognize.mockReset();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  S().reset();
});

describe('reading screenshots', () => {
  it('success: stages are reported, values extracted, reading state cleared', async () => {
    const seen: string[] = [];
    mockRecognize.mockImplementation(async (_i: unknown, on: (p: OcrProgress) => void) => {
      on({ stage: 'loading_engine' });
      seen.push(S().images[0].step!.stage);
      on({ stage: 'recognizing', fraction: 0.4 });
      seen.push(S().images[0].step!.stage);
      return lucid as OcrPage;
    });
    S().add([img('a')]);
    await S().readAll(db);
    const [a] = S().images;
    expect(seen).toEqual(['loading_engine', 'recognizing']);
    expect(a).toMatchObject({ status: 'done', step: null, error: null, reader: 'ocr' });
    expect(a.page!.fields.balance?.value).toBe(51240.5);
    expect(S().reading).toBe(false);
  });

  it('missing fields stay missing — nothing is invented', async () => {
    mockRecognize.mockResolvedValue(linesPage(['Account Balance $50,812.25']));
    S().add([img('a')]);
    await S().readAll(db);
    const f = S().images[0].page!.fields;
    expect(f.balance?.value).toBe(50812.25);
    for (const k of ['maxDrawdown', 'drawdownThreshold', 'profitTarget', 'accountSize', 'firm', 'program'] as FieldKey[]) expect(f[k]).toBeUndefined();
  });

  it('failed download: error state with the real (sanitised) cause, reading cleared', async () => {
    mockRecognize.mockRejectedValue(new OcrError('load_blocked', 'The text reader could not be downloaded.', 'TypeError: Failed to fetch'));
    S().add([img('a')]);
    await S().readAll(db);
    expect(S().images[0]).toMatchObject({ status: 'error', step: null, error: 'The text reader could not be downloaded.', errorDetail: 'TypeError: Failed to fetch' });
    expect(S().reading).toBe(false);
  });

  it('an unexpected exception still ends in an error, never a stuck "reading"', async () => {
    mockRecognize.mockRejectedValue(new Error('boom at https://x.test/a?token=1'));
    S().add([img('a')]);
    await S().readAll(db);
    expect(S().images[0]).toMatchObject({ status: 'error', errorDetail: 'Error: boom at [url]' });
    expect(S().reading).toBe(false);
  });

  it('retry after a failure reads again and succeeds', async () => {
    mockRecognize.mockRejectedValueOnce(new OcrError('read_timeout', 'Reading took too long.', 'no progress for 30 s')).mockResolvedValueOnce(lucid as OcrPage);
    S().add([img('a')]);
    await S().readAll(db);
    expect(S().images[0].status).toBe('error');
    await S().retry('a', db);
    expect(S().images[0]).toMatchObject({ status: 'done', error: null, errorDetail: null });
    expect(mockRecognize).toHaveBeenCalledTimes(2);
  });

  it('stale read: a read from a closed import never writes into the new one', async () => {
    const slow = deferred<OcrPage>();
    mockRecognize.mockReturnValueOnce(slow.promise);
    S().add([img('old')]);
    const first = S().readAll(db);
    await Promise.resolve();
    S().reset(); // trader left the screen
    mockRecognize.mockResolvedValueOnce(linesPage(['Account Balance $1,000.00']));
    S().add([img('new')]);
    await S().readAll(db);
    slow.resolve(lucid as OcrPage); // old result arrives late
    await first;
    expect(S().images.map((i) => i.image.id)).toEqual(['new']);
    expect(S().images[0].page!.fields.balance?.value).toBe(1000);
    expect(S().reading).toBe(false);
  });

  it('multiple screenshots: one failing does not stop the others', async () => {
    mockRecognize.mockRejectedValueOnce(new OcrError('image_failed', 'This file could not be opened as an image.')).mockResolvedValueOnce(lucid as OcrPage);
    S().add([img('a'), img('b')]);
    await S().readAll(db);
    expect(S().images.map((i) => i.status)).toEqual(['error', 'done']);
  });
});

describe('stale data', () => {
  const photo = (id: string, bytes: number) => ({ id, uri: `blob:${id}`, name: 'image.jpg', width: 1500, height: 2000, type: 'image/jpeg', bytes });

  it('a NEW photo with the same file name and size as an earlier one is read, not skipped for the old reading', async () => {
    mockRecognize.mockResolvedValueOnce(linesPage(['Account Balance $25,318.00'])).mockResolvedValueOnce(linesPage(['Account Balance $25,390.00']));
    S().add([photo('old', 401_000)]);
    await S().readAll(db);
    expect(S().add([photo('new', 433_374)])).toMatchObject({ added: 1, skipped: 0 });
    await S().readAll(db);
    expect(S().images.map((i) => i.page?.fields.balance?.value)).toEqual([25_318, 25_390]);
    expect(mockRecognize).toHaveBeenCalledTimes(2);
  });

  it('the same file picked twice is added once', () => {
    S().add([photo('a', 433_374)]);
    expect(S().add([photo('b', 433_374)])).toMatchObject({ added: 0, skipped: 1 });
  });

  it('a corrected value typed for the old screenshot does not carry over to a new one', async () => {
    mockRecognize.mockResolvedValue(linesPage(['Account Balance $25,390.00']));
    S().add([photo('old', 1)]);
    await S().readAll(db);
    S().setEdit('balance', 25_318);
    S().remove('old');
    expect(S().edits).toEqual({});
    S().setEdit('balance', 25_318);
    S().add([photo('new', 2)]);
    expect(S().edits).toEqual({});
  });

  it('two OCR passes of one photo are merged: agreeing values kept, disagreeing ones become a conflict', async () => {
    const page = linesPage(['Account Balance $25,300.00', 'Trading Days 11']);
    page.passes = [linesPage(['Account Balance $25,390.00', 'Trading Days 11'])];
    mockRecognize.mockResolvedValue(page);
    S().add([photo('p', 3)]);
    await S().readAll(db);
    const f = S().images[0].page!.fields;
    expect(f.tradingDays).toMatchObject({ value: 11 });
    expect(f.tradingDays?.alternatives).toBeUndefined();
    expect([f.balance!.value, ...f.balance!.alternatives!.map((a) => a.value)].sort()).toEqual([25_300, 25_390]);
  });

  it('an unreadable image: error state, nothing extracted', async () => {
    mockRecognize.mockRejectedValue(new OcrError('image_failed', 'This file could not be opened as an image.'));
    S().add([photo('x', 9)]);
    await S().readAll(db);
    expect(S().images[0]).toMatchObject({ status: 'error', page: null, error: 'This file could not be opened as an image.' });
  });
});

describe('confirm → account saved', () => {
  it('confirmed screenshot values (with a trader edit) update the account balance and drawdown tracking', async () => {
    mockRecognize.mockResolvedValue(lucid as OcrPage);
    S().add([img('a')]);
    await S().readAll(db);
    S().setEdit('balance', 51_000); // every value is editable before confirming
    const pages = S().images.map((i) => i.page!);
    const merged = mergePages(pages);
    merged.balance = { key: 'balance', value: 51_000, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 };
    const { fields } = crossCheck(merged);
    const c = confirmImport({ fields, edited: new Set<FieldKey>(['balance']), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: new Date('2026-10-10T12:00:00Z') });
    const acct = makeAccount({ balance: 50_000, startingBalance: 50_000, size: 50_000, highWaterMark: 50_000, rules: { ...makeAccount().rules, maxDrawdown: 2_000 } });
    const { account } = applyImport(acct, c, 'imp1');
    expect(account.balance).toBe(51_000);
    expect(account.importState?.reported?.balance).toBe(51_000);
    expect(account.importState?.reported?.drawdownThreshold).toBe(49_340);
    expect(account.importState?.history).toHaveLength(1);
  });
});
