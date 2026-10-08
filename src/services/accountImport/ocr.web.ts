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

async function getWorker(): Promise<TWorker> {
  if (!workerP) {
    workerP = (async () => {
      // The JS wrapper is small (~18 KB); the WASM engine and model load here, on first use.
      const T = Tesseract as unknown as { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } };
      const createWorker = (T.createWorker ?? T.default!.createWorker) as CreateWorker;
      return createWorker('eng', 1, {
        ...assetOptions(),
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') progressCb?.(0.3 + m.progress * 0.7);
          else if (m.status.startsWith('loading')) progressCb?.(Math.min(0.3, m.progress * 0.3));
        },
      });
    })();
    workerP.catch(() => {
      workerP = null;
    });
  }
  return workerP;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as an image.'));
    img.src = src;
  });
}

/**
 * Prepare for OCR: upscale small screenshots, grayscale, invert dark themes
 * (dark dashboards read better as dark-on-light) and stretch contrast.
 */
function preprocess(img: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number } {
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  const scale = w0 < 1400 ? Math.min(2.5, 2000 / Math.max(1, w0)) : Math.min(1, 3000 / w0);
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
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
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
  return { canvas, scale };
}

const unscale = (b: OcrBox, s: number): OcrBox => ({ x0: Math.round(b.x0 / s), y0: Math.round(b.y0 / s), x1: Math.round(b.x1 / s), y1: Math.round(b.y1 / s) });

export async function recognize(image: ImportImage, onProgress?: (p: number) => void): Promise<OcrPage> {
  progressCb = onProgress ?? null;
  const img = await loadImage(image.uri);
  const { canvas, scale } = preprocess(img);
  const worker = await getWorker();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Reading this screenshot took too long.')), 60_000));
  const { data } = await Promise.race([worker.recognize(canvas, {}, { blocks: true, text: false }), timeout]);
  progressCb = null;
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines) {
        const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), confidence: Math.round(w.confidence), bbox: unscale(w.bbox, scale) }));
        if (words.length) lines.push({ text: l.text.trim(), confidence: Math.round(l.confidence), bbox: unscale(l.bbox, scale), words });
      }
  return { width: img.naturalWidth, height: img.naturalHeight, confidence: Math.round(data.confidence), lines };
}

export async function disposeOcr(): Promise<void> {
  const w = workerP;
  workerP = null;
  if (w) await (await w).terminate().catch(() => undefined);
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
