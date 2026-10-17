import AsyncStorage from '@react-native-async-storage/async-storage';

import type { OcrBox } from '@/lib/engines/accountImport';

import type { ImportImage } from './images';
import { redactImage } from './ocr';
import { syncService } from '../syncService';

/**
 * Optional reference copy of the screenshots behind an account's values.
 *
 * - Kept on this device (AsyncStorage / browser storage). When the trader is signed in,
 *   the SAME redacted pages are also stored in their private cloud folder (`screenshots`
 *   bucket, `<user id>/accounts/<account id>/…`, row-level security: owner only), linked to
 *   the update-history record — so the reference survives a new device. The original,
 *   unredacted screenshot is never uploaded.
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

export type ReferenceSave = { saved: number; reason?: string; cloud: 'stored' | 'not_signed_in' | 'failed' | 'skipped'; cloudError?: string };

export async function saveReferenceCopy(
  accountId: string,
  shots: { image: ImportImage; sensitive: { bbox: OcrBox | null }[] }[],
  at: string,
  link: { recordId: string; dashboardDate: string | null } | null = null,
): Promise<ReferenceSave> {
  const pages: string[] = [];
  for (const s of shots.slice(0, MAX_PAGES)) {
    try {
      const boxes = s.sensitive.map((x) => x.bbox).filter((b): b is OcrBox => !!b);
      const r = await redactImage(s.image, boxes);
      if (!r?.base64) return { saved: 0, reason: 'Private details could not be blacked out on this device, so no copy was kept.', cloud: 'skipped' };
      pages.push(`data:image/jpeg;base64,${r.base64}`);
    } catch {
      return { saved: 0, reason: 'The reference copy could not be prepared on this device.', cloud: 'skipped' };
    }
  }
  if (!pages.length) return { saved: 0, cloud: 'skipped' };
  let saved = 0;
  let reason: string | undefined;
  try {
    await AsyncStorage.setItem(KEY(accountId), JSON.stringify({ at, pages } satisfies ReferenceCopy));
    saved = pages.length;
  } catch {
    // Browser storage full / unavailable: the account itself is saved regardless.
    reason = 'There was not enough storage on this device to keep a reference copy.';
  }
  const repo = syncService.repository();
  if (!repo || !link) return { saved, reason, cloud: repo ? 'skipped' : 'not_signed_in' };
  try {
    await repo.uploadAccountSnapshot(accountId, link.recordId, pages.map((p) => p.slice(p.indexOf(',') + 1)), link.dashboardDate);
    return { saved, reason, cloud: 'stored' };
  } catch (e) {
    return { saved, reason, cloud: 'failed', cloudError: (e as Error).message };
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

/** Delete the device copy and, when signed in, the account's stored cloud copies. */
export async function deleteReferenceCopy(accountId: string): Promise<{ cloudError?: string }> {
  try {
    await AsyncStorage.removeItem(KEY(accountId));
  } catch {
    // nothing to do
  }
  const repo = syncService.repository();
  if (!repo) return {};
  try {
    await repo.deleteAccountSnapshots(accountId);
    return {};
  } catch (e) {
    return { cloudError: (e as Error).message };
  }
}
