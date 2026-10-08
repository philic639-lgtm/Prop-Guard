import { useMemo } from 'react';

import { useFirmRules } from '@/features/accounts/useFirmRules';
import { crossCheck, matchImport, mergePages, type ExtractedField, type Extraction, type FieldKey, type FieldMap } from '@/lib/engines/accountImport';
import { useAppStore } from '@/store/useAppStore';
import type { Account } from '@/types/domain';

import { useImportSession } from './useImportSession';

/** Review model: screenshot readings + the trader's edits, re-checked and matched on every change. */
export function useImportReview(mode: 'new' | 'update', target: Account | null, includeAccounts: boolean) {
  const images = useImportSession((s) => s.images);
  const edits = useImportSession((s) => s.edits);
  const db = useFirmRules((s) => s.db);
  const accounts = useAppStore((s) => s.accounts);

  return useMemo(() => {
    const pages = images.filter((i) => i.page).map((i) => i.page!);
    const merged: FieldMap = mergePages(pages);
    const cleared = new Set<FieldKey>();
    for (const [k, v] of Object.entries(edits) as [FieldKey, number | string | null][]) {
      if (v == null || v === '') {
        delete merged[k];
        cleared.add(k);
      } else merged[k] = { key: k, value: v, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 } satisfies ExtractedField;
    }
    const { fields, checks } = crossCheck(merged, { noDerive: cleared });
    const sensitive = pages.flatMap((p) => p.sensitive);
    const extraction: Extraction = {
      fields,
      checks,
      sensitive,
      pages: pages.map((p) => ({ page: p.page, quality: p.quality, ocrConfidence: p.ocrConfidence, wordCount: p.wordCount, fieldCount: Object.keys(p.fields).length })),
      fingerprint: sensitive.find((s) => s.fingerprint)?.fingerprint ?? null,
    };
    const match = matchImport(extraction, { db, accounts: includeAccounts ? accounts : [], target, today: new Date().toISOString().slice(0, 10), mode });
    return { extraction, match, edited: new Set(Object.keys(edits) as FieldKey[]), db };
  }, [images, edits, db, accounts, target, mode, includeAccounts]);
}
