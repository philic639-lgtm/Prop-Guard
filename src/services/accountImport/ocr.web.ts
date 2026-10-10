import * as Tesseract from 'tesseract.js';

import type { OcrBox, OcrLine, OcrPage } from '@/lib/engines/accountImport';

import type { ImportImage } from './images';

/**
 * Free, in-browser OCR with tesseract.js (Apache-2.0). The screenshot never
 * leaves the device: only the OCR engine and English model are downloaded
 * (once, then cached by the browser) — from the jsDelivr CDN by default, or
 * from your own host via EXPO_PUBLIC_OCR_ASSETS_URL (see `npm run ocr:assets`).
 */
export const OCR_ENGINE = { id: 'tesseract' as const, label: 'On-device OCR (Tesseract)', free: true };

type TWorker = { recognize: (img: unknown, opts?: object, output?: object) => Promise<{ data: TData }>; terminate: () => Promise<unknown> };
interface TWord { text: string; confidence: number; bbox: OcrBox }
interface TData { confidence: number; blocks: { paragraphs: { lines: { text: string; confidence: number; bbox: OcrBox; words: TWord[] }[] }[] }[] | null }

type CreateWorker = (lang: string, oem: number, options: object) => Promise<TWorker>;
let workerP: Promise<TWorker> | null = null;
let progressCb: ((p: number) => void) | null = null;
/** Last sign of life from the OCR worker (download / recognition progress). */
let lastActivity = 0;

/** Failure reasons the import screen can explain (and retry). */
export type OcrErrorCode = 'load_failed' | 'load_timeout' | 'read_timeout' | 'image_failed';
export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
const MESSAGES: Record<OcrErrorCode, string> = {
  load_failed: 'The text reader could not be downloaded. Check your connection and try again.',
  load_timeout: 'The text reader took too long to download (about 7 MB, first use only). Try again, ideally on Wi-Fi.',
  read_timeout: 'Reading this screenshot took too long. Try again, or crop it to the account panel.',
  image_failed: 'This file could not be opened as an image.',
};
const fail = (code: OcrErrorCode) => new OcrError(code, MESSAGES[code]);

/** Download + start-up (~7 MB on first use; the download itself reports no progress). */
const LOAD_MS = 90_000;
/** Recognition of one prepared image; it reports progress, so a silent worker is stuck. */
const READ_MS = 90_000;
const STALL_MS = 30_000;

export function ocrAvailable(): boolean {
  return typeof document !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/** Absolute URL: the OCR worker runs from a blob and cannot resolve relative paths. */
const absolute = (raw: string) => new URL(raw.endsWith('/') ? raw : `${raw}/`, document.baseURI).href.replace(/\/$/, '');

function assetOptions() {
  const raw = process.env.EXPO_PUBLIC_OCR_ASSETS_URL;
  // Optional separate model location (e.g. a host that can't serve .gz files).
  const lang = process.env.EXPO_PUBLIC_OCR_LANG_URL;
  const out: Record<string, unknown> = {};
  if (raw) {
    const base = absolute(raw);
    Object.assign(out, { workerPath: `${base}/worker.min.js`, corePath: `${base}/core`, langPath: `${base}/lang`, gzip: true });
  }
  if (lang) Object.assign(out, { langPath: absolute(lang), gzip: true });
  return out;
}

/** Diagnostics in the browser console: stage names, timings and counts only — never screenshot text or values. */
export function ocrLog(event: string, detail: Record<string, string | number | boolean> = {}) {
  console.info(`[account-import] ${event}`, JSON.stringify(detail));
}

/**
 * Reject when `p` does not settle in `totalMs`, or when the worker shows no
 * activity for `stallMs`. Never leaves the caller waiting forever.
 */
function guard<T>(p: Promise<T>, totalMs: number, stallMs: number, code: OcrErrorCode): Promise<T> {
  lastActivity = Date.now();
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      const now = Date.now();
      if (now - started > totalMs || now - lastActivity > stallMs) reject(fail(code));
    }, 1000);
  });
  return Promise.race([p, watchdog]).finally(() => clearInterval(timer));
}

/** Drop a broken or stuck worker so the next attempt starts clean. */
function dropWorker() {
  const w = workerP;
  workerP = null;
  if (w) void w.then((x) => x.terminate()).catch(() => undefined);
}

async function getWorker(): Promise<TWorker> {
  if (!workerP) {
    const t0 = Date.now();
    ocrLog('engine: loading');
    const T = Tesseract as unknown as { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };
    const createWorker = (T.createWorker ?? T.default!.createWorker) as CreateWorker;
    let created: Promise<TWorker>;
    try {
      // The JS wrapper is small (~18 KB); the WASM engine and model load here, on first use.
      created = createWorker('eng', 1, {
        ...assetOptions(),
        logger: (m: { status: string; progress: number }) => {
          lastActivity = Date.now();
          if (m.status === 'recognizing text') progressCb?.(0.3 + m.progress * 0.7);
          else if (m.status.startsWith('loading')) progressCb?.(Math.min(0.3, m.progress * 0.3));
        },
        // Worker-level errors after start-up: surface them instead of hanging.
        errorHandler: () => dropWorker(),
      });
    } catch {
      throw fail('load_failed'); // e.g. workers blocked by the page's security policy
    }
    const p = guard(created, LOAD_MS, LOAD_MS, 'load_timeout').catch((e) => {
      void created.then((w) => w.terminate()).catch(() => undefined);
      throw e instanceof OcrError ? e : fail('load_failed');
    });
    workerP = p;
    p.then(
      () => ocrLog('engine: ready', { ms: Date.now() - t0 }),
      (e: OcrError) => {
        ocrLog('engine: failed', { code: e.code, ms: Date.now() - t0 });
        if (workerP === p) workerP = null;
      },
    );
  }
  return workerP;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(fail('image_failed'));
    img.src = src;
  });
}

/** Most pixels we hand to OCR (memory on phones, time on slow devices). */
const MAX_PIXELS = 10_000_000;

/**
 * Upscale factor. Desktop screenshots at normal resolution have ~11–13 px
 * labels, too small for Tesseract — double them. Retina / 4K captures and
 * phone screenshots (already 2–3× pixels) stay at native size.
 */
export function ocrScale(w: number, h: number): number {
  const portrait = h > w * 1.3;
  let s = w >= 2400 || (portrait && w >= 900) ? 1 : w <= 1000 ? 2.5 : 2;
  s = Math.min(s, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  return Math.max(0.5, Math.round(s * 100) / 100);
}

/**
 * Prepare for OCR: rescale (see `ocrScale`), grayscale, invert dark themes
 * (dark dashboards read better as dark-on-light) and stretch contrast.
 */
function preprocess(img: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number; dark: boolean } {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = ocrScale(w0, h0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let sum = 0;
  let lo = 255;
  let hi = 0;
  const gray = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    // Max channel keeps coloured text (green / red P&L) as bright as white text on dark themes.
    const g = Math.max(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2], 0.85 * Math.max(px[i], px[i + 1], px[i + 2]));
    gray[j] = g;
    sum += g;
  }
  const dark = sum / gray.length < 110;
  for (let j = 0; j < gray.length; j++) {
    const g = dark ? 255 - gray[j] : gray[j];
    gray[j] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((gray[j] - lo) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, scale, dark };
}

const unscale = (b: OcrBox, s: number): OcrBox => ({ x0: Math.round(b.x0 / s), y0: Math.round(b.y0 / s), x1: Math.round(b.x1 / s), y1: Math.round(b.y1 / s) });

export async function recognize(image: ImportImage, onProgress?: (p: number) => void): Promise<OcrPage> {
  const t0 = Date.now();
  progressCb = onProgress ?? null;
  try {
    const img = await loadImage(image.uri);
    const { canvas, scale, dark } = preprocess(img);
    ocrLog('image: prepared', { width: img.naturalWidth, height: img.naturalHeight, scale, dark });
    const worker = await getWorker();
    const t1 = Date.now();
    let data: TData;
    try {
      ({ data } = await guard(worker.recognize(canvas, {}, { blocks: true, text: false }), READ_MS, STALL_MS, 'read_timeout'));
    } catch (e) {
      // A stuck or crashed worker would block every later read: start fresh next time.
      dropWorker();
      throw e instanceof OcrError ? e : fail('read_timeout');
    }
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), confidence: Math.round(w.confidence), bbox: unscale(w.bbox, scale) }));
          if (words.length) lines.push({ text: l.text.trim(), confidence: Math.round(l.confidence), bbox: unscale(l.bbox, scale), words });
        }
    const words = lines.reduce((n, l) => n + l.words.length, 0);
    ocrLog('image: read', { ms: Date.now() - t1, totalMs: Date.now() - t0, lines: lines.length, words, confidence: Math.round(data.confidence) });
    return { width: img.naturalWidth, height: img.naturalHeight, confidence: Math.round(data.confidence), lines };
  } catch (e) {
    ocrLog('image: failed', { code: e instanceof OcrError ? e.code : 'unknown', ms: Date.now() - t0 });
    throw e;
  } finally {
    progressCb = null;
  }
}

export async function disposeOcr(): Promise<void> {
  dropWorker();
}

/** Black out regions on a copy of the image (account numbers, emails) before preview or sending. */
export async function redactImage(image: ImportImage, boxes: OcrBox[]): Promise<{ uri: string; base64: string } | null> {
  const img = await loadImage(image.uri);
  const canvas = document.createElement('canvas');
  const maxW = 1600;
  const s = Math.min(1, maxW / img.naturalWidth);
  canvas.width = Math.round(img.naturalWidth * s);
  canvas.height = Math.round(img.naturalHeight * s);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (const b of boxes) ctx.fillRect((b.x0 - 4) * s, (b.y0 - 4) * s, (b.x1 - b.x0 + 8) * s, (b.y1 - b.y0 + 8) * s);
  const uri = canvas.toDataURL('image/jpeg', 0.85);
  return { uri, base64: uri.slice(uri.indexOf(',') + 1) };
}
