/**
 * Screenshot file checks before anything is read. Pure — used by the picker,
 * drag & drop and paste paths, and unit-tested.
 */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif'] as const;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Larger images are slow to read and can exhaust memory on phones. */
export const MAX_PIXELS = 40_000_000;
export const MIN_SIDE = 200;

export interface FileFacts {
  name: string;
  type?: string | null;
  bytes?: number | null;
  width?: number | null;
  height?: number | null;
}

const EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/** null = OK, else a reason the trader can act on. */
export function rejectReason(f: FileFacts): string | null {
  const type = (f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || '').toLowerCase();
  // No type and no extension (e.g. camera captures on some devices): decoding decides — a corrupt file fails there.
  if (type && !(ACCEPTED_TYPES as readonly string[]).includes(type)) {
    const kind = (type.startsWith('image/') ? type.slice(6) : f.name.includes('.') ? f.name.split('.').pop()! : type.split('/').pop()!).toUpperCase();
    return `${f.name}: ${kind} files are not supported — use a PNG, JPG or WebP screenshot.`;
  }
  if (f.bytes != null && f.bytes > MAX_FILE_BYTES) return `${f.name}: larger than 15 MB — upload the original screenshot rather than a very large photo.`;
  if (f.bytes === 0) return `${f.name}: the file is empty.`;
  if (f.width != null && f.height != null) {
    if (f.width === 0 || f.height === 0) return `${f.name}: this file could not be opened as an image.`;
    if (f.width * f.height > MAX_PIXELS) return `${f.name}: the image is too large to read on this device — use a normal screenshot.`;
    if (Math.max(f.width, f.height) < MIN_SIDE) return `${f.name}: the image is too small to read — take a full-size screenshot.`;
  }
  return null;
}
