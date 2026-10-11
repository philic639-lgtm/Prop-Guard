import { OcrError } from '@/services/accountImport/ocrShared';
import { __resetBridge, attachHost, detachHost, hostAttached, onHostMessage, request } from '@/services/accountImport/webview/bridge';
import { OCR_WEBVIEW_JS, OCR_WEBVIEW_SOURCE_HASH, OCR_WEBVIEW_TESSERACT } from '@/services/accountImport/webview/bundle.generated';

/** A fake page: records what the app sent and lets the test answer like the WebView would. */
function fakePage() {
  const sent: { id: number; op: string; [k: string]: unknown }[] = [];
  const send = (m: string) => sent.push(JSON.parse(m));
  const reply = (m: unknown) => onHostMessage(JSON.stringify(m));
  return { sent, send, reply };
}
/** Requests are sent after an await (ready check): let them go out before the page answers. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('native OCR bridge (app ↔ hidden WebView)', () => {
  beforeEach(() => {
    jest.useRealTimers();
    __resetBridge();
  });

  it('refuses with a typed error when no reader is open (import screen closed)', async () => {
    expect(hostAttached()).toBe(false);
    await expect(request('recognize', {}, { timeoutMs: 1000 })).rejects.toMatchObject({ code: 'load_failed' });
  });

  it('waits for the page to start, forwards real progress and resolves with the page result', async () => {
    const page = fakePage();
    attachHost(page.send);
    const progress: unknown[] = [];
    const p = request<{ lines: unknown[] }>('recognize', { image: { id: 'i1', uri: 'data:image/jpeg;base64,AAAA' } }, { timeoutMs: 5000, onProgress: (x) => progress.push(x) });
    await Promise.resolve();
    expect(page.sent).toHaveLength(0); // not before the page says it is ready
    page.reply({ ready: true });
    await tick();
    expect(page.sent[0]).toMatchObject({ id: 1, op: 'recognize', image: { id: 'i1' } });
    page.reply({ id: 1, progress: { stage: 'downloading_model', received: 10, total: 100 } });
    page.reply({ id: 1, progress: { stage: 'recognizing', fraction: 0.5 } });
    page.reply({ id: 1, ok: true, result: { lines: [1, 2] } });
    await expect(p).resolves.toEqual({ lines: [1, 2] });
    expect(progress).toEqual([{ stage: 'downloading_model', received: 10, total: 100 }, { stage: 'recognizing', fraction: 0.5 }]);
  });

  it('maps page failures to the same typed errors (and messages) as the web reader', async () => {
    const page = fakePage();
    attachHost(page.send);
    page.reply({ ready: true });
    const a = request('recognize', {}, { timeoutMs: 5000 });
    const b = request('recognize', {}, { timeoutMs: 5000 });
    await tick();
    page.reply({ id: 1, ok: false, code: 'load_blocked', detail: 'TypeError: Failed to fetch' });
    page.reply({ id: 2, ok: false, code: 'something-unknown', detail: null });
    await expect(a).rejects.toMatchObject({ code: 'load_blocked', detail: 'TypeError: Failed to fetch' });
    await expect(a).rejects.toBeInstanceOf(OcrError);
    await expect(b).rejects.toMatchObject({ code: 'read_failed' });
  });

  it('never hangs: no answer → read_timeout; page never starts → load_failed', async () => {
    const page = fakePage();
    attachHost(page.send);
    await expect(request('recognize', {}, { timeoutMs: 50, readyMs: 30 })).rejects.toMatchObject({ code: 'load_failed' });
    page.reply({ ready: true });
    await expect(request('recognize', {}, { timeoutMs: 30 })).rejects.toMatchObject({ code: 'read_timeout' });
  });

  it('a crashed / closed WebView fails reads in flight (so the trader can retry)', async () => {
    const page = fakePage();
    attachHost(page.send);
    page.reply({ ready: true });
    const p = request('recognize', {}, { timeoutMs: 5000 });
    await tick();
    detachHost(page.send);
    await expect(p).rejects.toMatchObject({ code: 'load_failed' });
    expect(hostAttached()).toBe(false);
  });

  it('ignores malformed or unrelated messages', async () => {
    const page = fakePage();
    attachHost(page.send);
    page.reply({ ready: true });
    const p = request('redact', {}, { timeoutMs: 5000 });
    await tick();
    onHostMessage('not json');
    page.reply({ id: 999, ok: true, result: 'other' });
    page.reply({ id: 1, ok: true, result: { uri: 'data:image/jpeg;base64,x', base64: 'x' } });
    await expect(p).resolves.toMatchObject({ base64: 'x' });
  });
});

describe('WebView reader bundle', () => {
  it('is up to date with the web reader it is built from (run `npm run ocr:webview`)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHash } = require('node:crypto') as { createHash: (a: string) => { update: (s: string) => unknown; digest: (e: string) => string } };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('node:fs') as { readFileSync: (p: string, e: string) => string };
    const dir = `${process.cwd()}/src/services/accountImport/`;
    const h = createHash('sha256');
    for (const f of ['webview/entry.ts', 'ocr.web.ts', 'ocrShared.ts']) h.update(readFileSync(dir + f, 'utf8').replace(/\r\n/g, '\n'));
    const version = (require('tesseract.js/package.json') as { version: string }).version;
    h.update(`tesseract.js@${version}`);
    expect(OCR_WEBVIEW_SOURCE_HASH).toBe(h.digest('hex').slice(0, 16));
    expect(OCR_WEBVIEW_TESSERACT).toBe(version);
    expect(OCR_WEBVIEW_JS.length).toBeGreaterThan(10_000);
    // Never self-hosted / env URLs or secrets inside the app bundle.
    expect(OCR_WEBVIEW_JS).not.toMatch(/EXPO_PUBLIC_|service_role|sk-[A-Za-z0-9]/);
  });
});
