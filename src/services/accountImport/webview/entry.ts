/**
 * Runs INSIDE the hidden WebView on iOS / Android (bundled by `npm run ocr:webview`
 * into `bundle.generated.ts`). It is the same on-device reader as the web app —
 * `ocr.web.ts` (tesseract.js, image preparation, redaction) — driven over postMessage:
 *
 *   app → page   { id, op: 'prepare' | 'recognize' | 'redact' | 'dispose', image?, boxes? }
 *   page → app   { ready: true } once, then { id, progress } … and { id, ok, result | code, detail }
 *
 * The screenshot arrives as a data: URL and never leaves the device; only the OCR engine
 * and English model are downloaded (once, then cached by the WebView).
 */
import type { OcrBox } from '@/lib/engines/accountImport';

import { disposeOcr, prepareOcr, recognize, redactImage } from '../ocr.web';
import { OcrError, sanitizeDetail } from '../ocrShared';

type Request = { id: number; op: 'prepare' | 'recognize' | 'redact' | 'dispose'; image?: { id: string; uri: string; name: string; width: number; height: number }; boxes?: OcrBox[] };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(msg: string): void };
  }
}

const post = (m: unknown) => window.ReactNativeWebView?.postMessage(JSON.stringify(m));

async function handle(raw: unknown) {
  let req: Request;
  try {
    req = JSON.parse(String(raw)) as Request;
  } catch {
    return;
  }
  if (typeof req?.id !== 'number') return;
  const progress = (p: unknown) => post({ id: req.id, progress: p });
  try {
    let result: unknown = null;
    if (req.op === 'prepare') await prepareOcr(progress);
    else if (req.op === 'recognize' && req.image) result = await recognize(req.image, progress);
    else if (req.op === 'redact' && req.image) result = await redactImage(req.image, req.boxes ?? []);
    else if (req.op === 'dispose') await disposeOcr();
    else throw new OcrError('read_failed', 'Unknown request.');
    post({ id: req.id, ok: true, result });
  } catch (e) {
    post({ id: req.id, ok: false, code: e instanceof OcrError ? e.code : 'read_failed', detail: e instanceof OcrError ? e.detail : sanitizeDetail(e) });
  }
}

// iOS delivers postMessage on window, Android on document.
const onMessage = (e: Event) => void handle((e as MessageEvent).data);
window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);
post({ ready: true });
