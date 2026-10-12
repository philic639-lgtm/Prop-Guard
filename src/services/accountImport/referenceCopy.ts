import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OcrBox } from '@/lib/engines/accountImport';

import type { ImportImage } from './images';
import { redactImage } from './ocr';

/**
 * Optional reference copy of the screenshots behind an account's values.
 *
 * - Kept ON THIS DEVICE only (AsyncStorage / browser storage) — never synced,
 *   never uploaded, not part of the account record.
 * - Redacted first: account numbers, emails and other private details found by
 *   the reader are blacked out, and the image is downscaled (JPEG). If they
 *   cannot be blacked out on this device, nothing is kept.
 * - One copy per account (the latest confirmed import), at most 3 pages.
 */

export interface ReferenceCopy {
  at: string;
  /** Redacted JPEG data URIs. */
  pages: string[];
}

const KEY = (accountId: string) => `prop-guard-reference:${accountId}`;
const MAX_PAGES = 3;

export async function saveReferenceCopy(accountId: string, shots: { image: ImportImage; sensitive: { bbox: OcrBox | null }[] }[], at: string): Promise<{ saved: number; reason?: string }> {
  const pages: string[] = [];
  for (const s of shots.slice(0, MAX_PAGES)) {
    try {
      const boxes = s.sensitive.map((x) => x.bbox).filter((b): b is OcrBox => !!b);
      const r = await redactImage(s.image, boxes);
      if (!r?.base64) return { saved: 0, reason: 'Private details could not be blacked out on this device, so no copy was kept.' };
      pages.push(`data:image/jpeg;base64,${r.base64}`);
    } catch {
      return { saved: 0, reason: 'The reference copy could not be prepared on this device.' };
    }
  }
  if (!pages.length) return { saved: 0 };
  try {
    await AsyncStorage.setItem(KEY(accountId), JSON.stringify({ at, pages } satisfies ReferenceCopy));
    return { saved: pages.length };
  } catch {
    // Browser storage full / unavailable: the account itself is saved regardless.
    return { saved: 0, reason: 'There was not enough storage on this device to keep a reference copy.' };
  }
}

export async function loadReferenceCopy(accountId: string): Promise<ReferenceCopy | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY(accountId));
    if (!raw) return null;
    const v = JSON.parse(raw) as ReferenceCopy;
    return Array.isArray(v?.pages) && v.pages.every((p) => typeof p === 'string' && p.startsWith('data:image/')) ? v : null;
  } catch {
    return null;
  }
}

export async function deleteReferenceCopy(accountId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY(accountId));
  } catch {
    // nothing to do
  }
}
