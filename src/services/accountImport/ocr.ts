import type { OcrBox, OcrPage } from '@/lib/engines/accountImport';

import type { ImportImage } from './images';

/**
 * On-device OCR — NATIVE build. Free browser OCR (tesseract.js) runs on web
 * (`ocr.web.ts`). iOS/Android need a native text-recognition module (ML Kit /
 * Apple Vision) in a development build; until one is added, native imports use
 * the optional advanced reader or manual entry.
 */
export const OCR_ENGINE = { id: 'none' as const, label: 'Not available on this device', free: true };

export function ocrAvailable(): boolean {
  return false;
}

export async function recognize(_image: ImportImage, _onProgress?: (p: number) => void): Promise<OcrPage> {
  throw new Error('On-device text recognition is not available in this build.');
}

export async function disposeOcr(): Promise<void> {}

/** Black out regions (account numbers…) — needs a canvas; unavailable on native. */
export async function redactImage(_image: ImportImage, _boxes: OcrBox[]): Promise<{ uri: string; base64: string } | null> {
  return null;
}
