import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase/client';

/**
 * Screenshot pipeline: pick → compress/resize → (optional) upload.
 * Images are downscaled to keep AI payloads and storage small.
 */
export interface PreparedScreenshot {
  uri: string;
  base64: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
}

const MAX_WIDTH = 1280;
const QUALITY = 0.7;

export type PickResult = { status: 'ok'; image: PreparedScreenshot } | { status: 'cancelled' } | { status: 'denied' } | { status: 'error'; message: string };

export async function pickScreenshot(source: 'library' | 'camera' = 'library'): Promise<PickResult> {
  try {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };

    const asset = result.assets[0];
    const image = await compress(asset.uri, asset.width);
    return { status: 'ok', image };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}

export async function compress(uri: string, width?: number): Promise<PreparedScreenshot> {
  const ctx = ImageManipulator.manipulate(uri);
  if (!width || width > MAX_WIDTH) ctx.resize({ width: MAX_WIDTH });
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG, base64: true });
  return { uri: saved.uri, base64: saved.base64 ?? '', width: saved.width, height: saved.height, mimeType: 'image/jpeg' };
}

/** Upload to the private `screenshots` bucket under the user's folder. Returns the storage path. */
export async function uploadScreenshot(userId: string, image: PreparedScreenshot): Promise<string | null> {
  if (!supabase) return null;
  const path = `${userId}/${Date.now()}.jpg`;
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const { error } = await supabase.storage.from('screenshots').upload(path, bytes, { contentType: 'image/jpeg' });
  if (error) {
    console.warn('[screenshot] upload failed', error.message);
    return null;
  }
  await supabase.from('screenshots').insert({ user_id: userId, storage_path: path, width: image.width, height: image.height });
  return path;
}
