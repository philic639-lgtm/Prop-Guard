import type { FirmRulesDatabase } from '@/data/propFirms/types';
import type { Account, AccountDetailKey } from '@/types/domain';

import { manualConflicts, type ManualConflict } from './accountDetails';
import {
  applyImport,
  confirmImport,
  crossCheck,
  detectedSize,
  matchImport,
  mergeAmbiguous,
  mergePages,
  type ApplyResult,
  type ConfirmedImport,
  type ExtractedField,
  type Extraction,
  type FieldKey,
  type FieldMap,
  type ImportConflict,
  LOW_CONFIDENCE,
  type PageExtraction,
  type PlausibilityContext,
} from './accountImport';
import { findFirm } from './firmRulesEngine';
import { compareUpdate, providedFigures, type ChangeRow } from './accountUpdate';
import { findLikelyDuplicate, olderSnapshot } from './accountSync';

/**
 * Update several accounts from several screenshots in one go. Each screenshot is read and
 * matched ON ITS OWN (never merged with another account's screenshot), then planned with
 * the SAME engines as a single update (`matchImport` checks, `applyImport`, manual
 * corrections, older-snapshot guard). Nothing is ever assigned silently:
 *
 *   account_number  the screenshot's account number matches exactly one saved account
 *   likely          one account fits firm + size (+ program) but no account number is visible → trader confirms
 *   ambiguous       several accounts fit → trader picks
 *   none            no account fits → trader picks one or skips it
 */

export type MatchCertainty = 'account_number' | 'likely' | 'ambiguous' | 'none';

export interface BulkMatch {
  certainty: MatchCertainty;
  /** Pre-selected account (only for `account_number` and `likely`). */
  accountId: string | null;
  candidates: { accountId: string; name: string }[];
  note: string;
}

/** One screenshot's own extraction (+ the trader's corrections for it). */
export function extractionOf(page: PageExtraction, edits: Partial<Record<FieldKey, number | string | null>> = {}, context?: PlausibilityContext): Extraction {
  const merged: FieldMap = mergePages([page]);
  const cleared = new Set<FieldKey>();
  for (const [k, v] of Object.entries(edits) as [FieldKey, number | string | null][]) {
    if (v == null || v === '') {
      delete merged[k];
      cleared.add(k);
    } else merged[k] = { key: k, value: v, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 } satisfies ExtractedField;
  }
  const cc = crossCheck(merged, { noDerive: cleared, context });
  const ambiguous = [...mergeAmbiguous([page], cc.fields), ...cc.ambiguous];
  return {
    fields: cc.fields,
    ...(ambiguous.length ? { ambiguous } : {}),
    checks: cc.checks,
    sensitive: page.sensitive,
    pages: [{ page: page.page, quality: page.quality, ocrConfidence: page.ocrConfidence, wordCount: page.wordCount, fieldCount: Object.keys(page.fields).length }],
    fingerprint: page.sensitive.find((s) => s.fingerprint)?.fingerprint ?? null,
  };
}

export function matchToAccount(x: Extraction, accounts: Account[], db: FirmRulesDatabase): BulkMatch {
  const live = accounts.filter((a) => a.status !== 'archived');
  const pick = (a: Account) => ({ accountId: a.id, name: a.name });
  if (x.fingerprint) {
    const same = live.filter((a) => a.importState?.fingerprint === x.fingerprint);
    if (same.length === 1) return { certainty: 'account_number', accountId: same[0]!.id, candidates: [pick(same[0]!)], note: `Account number matches “${same[0]!.name}”.` };
  }
  const firmName = typeof x.fields.firm?.value === 'string' ? x.fields.firm.value : null;
  const firm = firmName ? findFirm(db, firmName) : null;
  const size = detectedSize(x);
  // A different account number on file rules an account out.
  const pool = live.filter((a) => !(x.fingerprint && a.importState?.fingerprint && a.importState.fingerprint !== x.fingerprint));
  const fits = firm && size ? pool.filter((a) => findLikelyDuplicate([a], { firm: firm.name, firmId: firm.id, size, kind: 'prop', fingerprint: x.fingerprint }) != null) : [];
  if (fits.length === 1)
    return { certainty: 'likely', accountId: fits[0]!.id, candidates: [pick(fits[0]!)], note: `Looks like “${fits[0]!.name}” (${firm!.name}, $${Math.round(size! / 1000)}K) — no account number visible, so please confirm.` };
  if (fits.length > 1) return { certainty: 'ambiguous', accountId: null, candidates: fits.map(pick), note: `${fits.length} of your accounts match ${firm!.name} $${Math.round(size! / 1000)}K — choose which one this screenshot belongs to.` };
  return {
    certainty: 'none',
    accountId: null,
    candidates: pool.map(pick),
    note: firm || size ? 'No saved account matches this screenshot. Choose the account, or skip it.' : 'Firm and account size could not be read. Choose the account, or skip it.',
  };
}

export type BulkStatus = 'ready' | 'needs_account' | 'needs_confirmation' | 'needs_values' | 'needs_ack' | 'duplicate_target' | 'single_update' | 'skipped';

export interface BulkItemInput {
  id: string;
  extraction: Extraction;
  match: BulkMatch;
  /** The account the trader chose / confirmed (null = not yet). */
  accountId: string | null;
  /** The trader confirmed a `likely` / chosen match. */
  matchConfirmed: boolean;
  skipped: boolean;
  /** Acknowledged warnings (conflict messages, older screenshot). */
  acks: Record<string, boolean>;
  /** Per manual correction: keep the trader's value (default) or take the screenshot's. */
  manualChoice: Partial<Record<AccountDetailKey, 'keep' | 'screenshot'>>;
}

export interface BulkPlanItem {
  id: string;
  status: BulkStatus;
  account: Account | null;
  /** What still needs the trader, in plain words. */
  reasons: string[];
  /** Warnings that need an "I checked this" before saving (id → text). */
  acksNeeded: { id: string; text: string }[];
  manual: ManualConflict[];
  changes: ChangeRow[];
  confirmed: ConfirmedImport | null;
}

const OLDER = 'older-screenshot';

export function planBulk(items: BulkItemInput[], ctx: { accounts: Account[]; db: FirmRulesDatabase; now: Date }): BulkPlanItem[] {
  const today = ctx.now.toISOString().slice(0, 10);
  const targets = new Map<string, number>();
  for (const it of items) if (!it.skipped && it.accountId) targets.set(it.accountId, (targets.get(it.accountId) ?? 0) + 1);

  return items.map((it): BulkPlanItem => {
    const base = { id: it.id, account: null as Account | null, reasons: [] as string[], acksNeeded: [] as { id: string; text: string }[], manual: [] as ManualConflict[], changes: [] as ChangeRow[], confirmed: null as ConfirmedImport | null };
    if (it.skipped) return { ...base, status: 'skipped' };
    const account = it.accountId ? (ctx.accounts.find((a) => a.id === it.accountId) ?? null) : null;
    if (!account) return { ...base, status: 'needs_account', reasons: [it.match.note] };
    base.account = account;
    if ((targets.get(account.id) ?? 0) > 1) return { ...base, status: 'duplicate_target', reasons: [`Another screenshot is also assigned to “${account.name}”. Skip one of them, or update them one at a time.`] };
    if (it.match.certainty !== 'account_number' && !it.matchConfirmed) return { ...base, status: 'needs_confirmation', reasons: [it.match.note] };

    const x = it.extraction;
    const f = x.fields;
    const unclear = (k: FieldKey) => {
      const v = f[k];
      return !v || (v.source !== 'user' && v.source !== 'derived' && v.confidence < LOW_CONFIDENCE) || (x.ambiguous ?? []).some((a) => a.key === k);
    };
    if (typeof f.balance?.value !== 'number') return { ...base, status: 'needs_values', reasons: ['The balance could not be read — enter it, or skip this screenshot.'] };
    // Readings that disagree, or values that do not add up, need a correction — never a tick in a bulk list.
    const contradictions = x.checks.filter((c) => c.status === 'conflict' && c.id !== 'different-accounts' && !c.fields.every((k) => f[k]?.source === 'user'));
    if (contradictions.length)
      return { ...base, status: 'single_update', reasons: [`${contradictions[0].message} Open it as a single update to correct it.`] };
    if (unclear('balance')) base.acksNeeded.push({ id: 'uncertain-balance', text: `Needs verification: the balance reading ($${Number(f.balance.value).toLocaleString('en-US')}) is uncertain — check it against the screenshot or correct it.` });

    // Same checks as a single update: wrong account, firm / size / stage, lower floor.
    const m = matchImport(x, { db: ctx.db, accounts: ctx.accounts, target: account, today, mode: 'update' });
    const blocking: ImportConflict[] = m.conflicts.filter((c) => c.severity === 'conflict');
    // A lower floor needs an explicit reset decision — done in the single update screen, never in bulk.
    const keepThreshold = it.manualChoice.drawdownThreshold !== 'screenshot';
    const manual = manualConflicts(account, Object.fromEntries(Object.entries(f).filter(([, v]) => v && v.source !== 'derived').map(([k, v]) => [k, v!.value])));
    base.manual = manual;
    if (blocking.some((c) => c.field === 'drawdownThreshold') && !(keepThreshold && manual.some((c) => c.key === 'drawdownThreshold')))
      return { ...base, status: 'single_update', reasons: ['The screenshot shows a lower liquidation threshold than the account’s current floor (a reset, or a misread). Open it as a single update to decide.'] };
    for (const c of blocking.filter((c) => c.field !== 'drawdownThreshold')) base.acksNeeded.push({ id: `m:${c.field}:${c.message}`, text: c.message });
    for (const c of m.conflicts.filter((c) => c.severity === 'warning')) base.acksNeeded.push({ id: `w:${c.field}:${c.message}`, text: c.message });
    const statementDate = typeof f.statementDate?.value === 'string' ? f.statementDate.value : null;
    const older = olderSnapshot(account, statementDate);
    if (older) base.acksNeeded.push({ id: OLDER, text: `This screenshot is from ${older.screenshot}; “${account.name}” already has values from ${older.account}. Saving it would replace newer values.` });

    const keepManual = manual.filter((c) => it.manualChoice[c.key] !== 'screenshot').map((c) => c.key);
    const edited = new Set((Object.keys(f) as FieldKey[]).filter((k) => f[k]?.source === 'user'));
    const confirmed = confirmImport({ fields: f, edited, fingerprint: x.fingerprint, maskedId: null, engine: 'ocr', pages: 1, now: ctx.now, keepManual });
    let preview: ApplyResult;
    try {
      preview = applyImport(account, confirmed, `${it.id}-preview`);
    } catch (e) {
      return { ...base, status: 'single_update', reasons: [`This update could not be prepared (${(e as Error).message}). Open it as a single update.`] };
    }
    base.changes = compareUpdate(account, preview.account, providedFigures(Object.keys(confirmed.values).filter((k) => confirmed.sources[k as FieldKey]?.source !== 'derived')));
    base.confirmed = confirmed;
    const missingAcks = base.acksNeeded.filter((a) => !it.acks[a.id]);
    return { ...base, status: missingAcks.length ? 'needs_ack' : 'ready' };
  });
}

export const BULK_STATUS_LABEL: Record<BulkStatus, string> = {
  ready: 'Ready to save',
  needs_account: 'Choose the account',
  needs_confirmation: 'Confirm the account',
  needs_values: 'Needs a value',
  needs_ack: 'Check the warnings',
  duplicate_target: 'Two screenshots, one account',
  single_update: 'Update separately',
  skipped: 'Skipped',
};

export interface BulkResult {
  id: string;
  accountName: string;
  ok: boolean;
  message: string;
}
