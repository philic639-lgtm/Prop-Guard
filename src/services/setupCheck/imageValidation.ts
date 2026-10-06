/**
 * Client-side image checks before anything is sent: allowed type, real file
 * signature (not just the claimed MIME), size limit. The server repeats them.
 */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function sniffImageType(base64: string): AllowedImageType | null {
  let bytes: number[];
  try {
    bytes = Array.from(atob(base64.slice(0, 16)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export type ImageCheck = { ok: true; mimeType: AllowedImageType; bytes: number } | { ok: false; reason: 'empty' | 'type' | 'size' | 'corrupt' };

export function validateImage(image: { base64: string; mimeType: string } | null | undefined): ImageCheck {
  if (!image?.base64) return { ok: false, reason: 'empty' };
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(image.mimeType)) return { ok: false, reason: 'type' };
  if (!B64.test(image.base64.slice(0, 4000))) return { ok: false, reason: 'corrupt' };
  const bytes = Math.floor((image.base64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, reason: 'size' };
  const sniffed = sniffImageType(image.base64);
  if (!sniffed || sniffed !== image.mimeType) return { ok: false, reason: 'corrupt' };
  return { ok: true, mimeType: sniffed, bytes };
}
