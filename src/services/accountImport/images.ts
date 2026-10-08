import * as ImagePicker from 'expo-image-picker';

/**
 * Screenshots for account import. Kept in memory only for the duration of
 * the import (object URLs / local file URIs) — never uploaded or stored.
 */
export interface ImportImage {
  id: string;
  uri: string;
  name: string;
  width: number;
  height: number;
  /** Web: the original File (lets OCR read it without re-encoding). */
  file?: Blob;
}

export const MAX_IMAGES = 5;

export type PickImagesResult = { status: 'ok'; images: ImportImage[] } | { status: 'cancelled' } | { status: 'denied' } | { status: 'error'; message: string };

let seq = 0;
export const imageId = () => `img${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Photo library (several at once) or camera. */
export async function pickImages(source: 'library' | 'camera', limit = MAX_IMAGES): Promise<PickImagesResult> {
  try {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: source === 'library',
      selectionLimit: limit,
      exif: false,
    };
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (r.canceled || !r.assets?.length) return { status: 'cancelled' };
    return {
      status: 'ok',
      images: r.assets.slice(0, limit).map((a, i) => ({
        id: imageId(),
        uri: a.uri,
        name: a.fileName ?? `Screenshot ${i + 1}`,
        width: a.width,
        height: a.height,
        ...(a.file ? { file: a.file } : {}),
      })),
    };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}

/** Release in-memory image data (web object URLs). */
export function releaseImages(images: ImportImage[]) {
  for (const i of images) if (i.uri.startsWith('blob:') && typeof URL !== 'undefined') URL.revokeObjectURL(i.uri);
}
