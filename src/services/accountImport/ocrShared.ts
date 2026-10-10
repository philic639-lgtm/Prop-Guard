/**
 * Shared by the web OCR (`ocr.web.ts`) and the native stub (`ocr.ts`): progress
 * stages, typed errors with a sanitised cause, and safe console diagnostics.
 */
/**
 * What the reader is doing right now. Numbers are only ever real ones (bytes
 * received, tesseract's own recognition progress) — never estimates.
 */
export type OcrProgress =
  | { stage: 'loading_engine' }
  | { stage: 'downloading_model'; received: number; total: number | null }
  | { stage: 'starting_engine' }
  | { stage: 'recognizing'; fraction: number | null };

/** Failure reasons the import screen can explain (and retry). */
export type OcrErrorCode = 'load_failed' | 'load_blocked' | 'load_missing' | 'load_timeout' | 'read_timeout' | 'read_failed' | 'image_failed';
export class OcrError extends Error {
  constructor(
    readonly code: OcrErrorCode,
    message: string,
    /** Sanitised technical cause ("HTTP 404", "TypeError: Failed to fetch") — no URLs, no screenshot content. */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'OcrError';
  }
}
export const MESSAGES: Record<OcrErrorCode, string> = {
  load_failed: 'The text reader could not start in this browser. Try again, or enter the values manually.',
  load_blocked: 'The text reader could not be downloaded — you may be offline, or this page blocks the download. Check your connection and try again.',
  load_missing: 'The text reader files are missing on this server. Enter the values manually; the app owner needs to add the OCR files (npm run ocr:assets).',
  load_timeout: 'The text reader took too long to download (about 7 MB, first use only). Try again, ideally on Wi-Fi.',
  read_timeout: 'Reading this screenshot took too long. Try again, or crop it to the account panel.',
  read_failed: 'The text reader stopped while reading this screenshot. Try again.',
  image_failed: 'This file could not be opened as an image.',
};
/** Error text safe to show and log: URLs, emails and long digit runs removed, length capped. */
export function sanitizeDetail(raw: unknown): string | null {
  if (raw == null) return null;
  const text = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw);
  const clean = text
    .replace(/\b(?:https?|blob|data|file):[^\s'")]+/gi, '[url]')
    .replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\d{5,}/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, 160) : null;
}
/** Diagnostics in the browser console: stage names, timings, counts and error codes only — never screenshot text or values. */
export function ocrLog(event: string, detail: Record<string, string | number | boolean | null> = {}) {
  console.info(`[account-import] ${event}`, JSON.stringify(detail));
}

