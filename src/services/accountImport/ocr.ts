import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { OcrBox, OcrPage } from '@/lib/engines/accountImport';

import type { ImportImage } from './images';
import { MESSAGES, OcrError, ocrLog, sanitizeDetail, type OcrProgress } from './ocrShared';
import { hostAttached, request } from './webview/bridge';

/**
 * On-device OCR — iOS / Android. The SAME free reader as the web app
 * (`ocr.web.ts`: tesseract.js, image preparation, redaction) runs inside a hidden
 * WebView mounted by the import screen (`NativeOcrHost`). The screenshot is re-encoded
 * on the device (HEIC → JPEG) and handed to that page as a data: URL — it never leaves
 * the phone. First use downloads the engine + English model (~7 MB) from jsDelivr.
 */
export const OCR_ENGINE = { id: 'tesseract' as const, label: 'On-device OCR (Tesseract)', free: true };

export { OcrError, ocrLog, sanitizeDetail, type OcrErrorCode, type OcrProgress } from './ocrShared';

/** Overall limits on the app side (the page has its own, shorter ones). */
const RECOGNIZE_MS = 200_000;
const REDACT_MS = 30_000;
/** Pixel budget for OCR: phone screenshots (≈3–4 MP) keep their size; 12 MP+ camera photos are reduced. */
const MAX_PIXELS = 8_000_000;

export function ocrAvailable(): boolean {
  return hostAttached();
}

/** JPEG data: URL of the image (also converts iPhone HEIC photos, which WebViews cannot decode). Cached per image. */
const prepared = new Map<string, Promise<{ uri: string; width: number; height: number }>>();
function prepare(image: ImportImage) {
  let p = prepared.get(image.id);
  if (!p) {
    p = (async () => {
      const ctx = ImageManipulator.manipulate(image.uri);
      const px = (image.width || 0) * (image.height || 0);
      if (px > MAX_PIXELS) ctx.resize({ width: Math.round(image.width * Math.sqrt(MAX_PIXELS / px)) });
      const ref = await ctx.renderAsync();
      const saved = await ref.saveAsync({ compress: 0.92, format: SaveFormat.JPEG, base64: true });
      if (!saved.base64) throw new Error('no image data');
      return { uri: `data:image/jpeg;base64,${saved.base64}`, width: saved.width, height: saved.height };
    })().catch((e) => {
      prepared.delete(image.id);
      throw new OcrError('image_failed', MESSAGES.image_failed, sanitizeDetail(e));
    });
    prepared.set(image.id, p);
  }
  return p;
}

export async function recognize(image: ImportImage, onProgress?: (p: OcrProgress) => void): Promise<OcrPage> {
  const t0 = Date.now();
  const img = await prepare(image);
  const page = await request<OcrPage>('recognize', { image: { id: image.id, name: image.name, uri: img.uri, width: img.width, height: img.height } }, { timeoutMs: RECOGNIZE_MS, onProgress });
  ocrLog('native: read', { ms: Date.now() - t0, lines: page.lines.length, confidence: page.confidence });
  return page;
}

export async function prepareOcr(onProgress?: (p: OcrProgress) => void): Promise<void> {
  await request('prepare', {}, { timeoutMs: RECOGNIZE_MS, onProgress });
}

export async function disposeOcr(): Promise<void> {
  prepared.clear();
  if (hostAttached()) await request('dispose', {}, { timeoutMs: 5_000, readyMs: 1_000 }).catch(() => undefined);
}

/** Black out regions (account numbers, emails) on a copy — before the optional advanced reader sees it. */
export async function redactImage(image: ImportImage, boxes: OcrBox[]): Promise<{ uri: string; base64: string } | null> {
  if (!hostAttached()) return null;
  const img = await prepare(image);
  return request<{ uri: string; base64: string } | null>('redact', { image: { id: image.id, name: image.name, uri: img.uri, width: img.width, height: img.height }, boxes }, { timeoutMs: REDACT_MS });
}
