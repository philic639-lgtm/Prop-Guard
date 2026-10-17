/**
 * One authoritative account record: duplicate detection, journal P&L vs. a confirmed
 * balance, older screenshots, cloud merge and save read-back (pure helpers).
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';
import { makeAccount } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import { extractPage, looksLikeAccountId, matchImport, screenshotChecks, type FieldMap, type OcrPage, type PageExtraction } from '../accountImport';
import { accountDataDate, findLikelyDuplicate, mergeRemoteAccounts, olderSnapshot, tradeInBalance, verifyPersisted } from '../accountSync';

const confirmed = (over: Partial<Account> = {}, at = '2026-10-13T15:00:00Z', asOf: string | null = '2026-10-13'): Account =>
  makeAccount({
    id: 'flex',
    name: 'LucidFlex 25K Evaluation',
    firm: 'Lucid Trading',
    balance: 25_246,
    highWaterMark: 25_270,
    importState: {
      fingerprint: null,
      maskedId: null,
      reported: { at, asOf, balance: 25_246, drawdownThreshold: 24_270 } as never,
      history: [],
      threshold: { value: 24_270, source: 'screenshot', at },
      origins: { balance: { source: 'screenshot', at } },
    },
    ...over,
  });

describe('duplicate accounts', () => {
  const existing = makeAccount({ id: 'old', name: 'Lucid 25K', firm: 'Lucid Trading', size: 25_000 });

  it('finds the same firm + size even without a program link', () => {
    expect(findLikelyDuplicate([existing], { firm: 'Lucid Trading', size: 25_000, kind: 'prop', programId: 'lucid:flex-eval:25k' })?.id).toBe('old');
    expect(findLikelyDuplicate([existing], { firm: 'LUCID', size: 25_000, kind: 'prop' })?.id).toBe('old');
  });

  it('never matches itself, other sizes, other firms, other programs or another account number', () => {
    expect(findLikelyDuplicate([existing], { id: 'old', firm: 'Lucid Trading', size: 25_000, kind: 'prop' })).toBeNull();
    expect(findLikelyDuplicate([existing], { firm: 'Lucid Trading', size: 50_000, kind: 'prop' })).toBeNull();
    expect(findLikelyDuplicate([existing], { firm: 'Topstep', size: 25_000, kind: 'prop' })).toBeNull();
    const linked = { ...existing, firmLink: { programId: 'lucid:pro:25k' } as never };
    expect(findLikelyDuplicate([linked], { firm: 'Lucid Trading', size: 25_000, kind: 'prop', programId: 'lucid:flex-eval:25k' })).toBeNull();
    const printed = { ...existing, importState: { fingerprint: 'a', maskedId: null, reported: null, history: [] } };
    expect(findLikelyDuplicate([printed], { firm: 'Lucid Trading', size: 25_000, kind: 'prop', fingerprint: 'b' })).toBeNull();
    expect(findLikelyDuplicate([{ ...existing, status: 'archived' as never }], { firm: 'Lucid Trading', size: 25_000, kind: 'prop' })).toBeNull();
  });

  it('a screenshot import flags the unlinked account instead of creating a second one', () => {
    const fields: FieldMap = {
      firm: { key: 'firm', value: 'Lucid Trading', confidence: 0.95, source: 'ocr', evidence: '', page: 0 },
      program: { key: 'program', value: 'LucidFlex 25K Evaluation', confidence: 0.9, source: 'ocr', evidence: '', page: 0 },
      startingBalance: { key: 'startingBalance', value: 25_000, confidence: 0.95, source: 'ocr', evidence: '', page: 0 },
      balance: { key: 'balance', value: 25_246, confidence: 0.95, source: 'ocr', evidence: '', page: 0 },
    };
    const m = matchImport({ fields, sensitive: [], pages: [], checks: [], fingerprint: null }, { db: FIRM_RULES_SEED, accounts: [existing], target: null, today: '2026-10-13', mode: 'new' });
    expect(m.duplicate).toMatchObject({ accountId: 'old', reason: 'same_configuration' });
  });
});

describe('screenshot identity', () => {
  it('a dashboard date is never read as an account number', () => {
    expect(looksLikeAccountId('2026-10-13')).toBe(false);
    expect(looksLikeAccountId('10-13-2026')).toBe(false);
    expect(looksLikeAccountId('LT-25K-771203')).toBe(true);
  });

  it('one screenshot with an account number and a date is not "different accounts"', () => {
    const page: OcrPage = {
      width: 900,
      height: 200,
      lines: [{ text: 'Account LT-25K-771203 | Status: Active | As of 2026-10-13', confidence: 95, bbox: { x0: 0, y0: 0, x1: 600, y1: 20 }, words: ['Account', 'LT-25K-771203', '|', 'Status:', 'Active', '|', 'As', 'of', '2026-10-13'].map((text, i) => ({ text, confidence: 95, bbox: { x0: i * 60, y0: 0, x1: i * 60 + 55, y1: 20 } })) }],
    } as never;
    const ext = extractPage(page, 0, { firms: FIRM_RULES_SEED.firms });
    expect(ext.sensitive.filter((s) => s.kind === 'account_id')).toHaveLength(1);
    expect(screenshotChecks([ext]).find((c) => c.id === 'different-accounts')).toBeUndefined();
  });

  it('two screenshots of different account numbers still block', () => {
    const pageWith = (fp: string) => ({ sensitive: [{ kind: 'account_id', fingerprint: fp }] }) as unknown as PageExtraction;
    const withDates = (p: PageExtraction) => ({ ...p, fields: {} }) as PageExtraction;
    expect(screenshotChecks([withDates(pageWith('a')), withDates(pageWith('b'))]).find((c) => c.id === 'different-accounts')).toBeDefined();
    expect(screenshotChecks([withDates(pageWith('a')), withDates(pageWith('a'))]).find((c) => c.id === 'different-accounts')).toBeUndefined();
  });
});

describe('journal trades vs. a confirmed balance', () => {
  const a = confirmed();
  it('a trade closed before the balance was confirmed is already in it', () => {
    expect(tradeInBalance(a, '2026-10-13T14:30:00Z')).toBe(true);
    expect(tradeInBalance(a, '2026-10-13T15:00:00Z')).toBe(true);
  });
  it('a later trade, or an account without a confirmed balance, moves the balance', () => {
    expect(tradeInBalance(a, '2026-10-13T15:30:00Z')).toBe(false);
    expect(tradeInBalance(makeAccount(), '2026-10-13T14:30:00Z')).toBe(false);
    expect(tradeInBalance(a, null)).toBe(false);
  });
});

describe('older screenshots', () => {
  it('a screenshot older than the account’s data is flagged', () => {
    expect(olderSnapshot(confirmed(), '2026-10-10')).toEqual({ screenshot: '2026-10-10', account: '2026-10-13' });
    expect(olderSnapshot(confirmed(), '2026-10-13')).toBeNull();
    expect(olderSnapshot(confirmed(), '2026-10-14')).toBeNull();
    expect(olderSnapshot(confirmed(), null)).toBeNull();
    expect(olderSnapshot(null, '2026-10-10')).toBeNull();
  });
  it('a typed balance counts as the account’s newest data; a confirmation time alone does not', () => {
    const typed = confirmed({}, '2026-10-12T15:00:00Z', null);
    typed.importState!.origins = { balance: { source: 'manual', at: '2026-10-12T15:00:00Z' } };
    expect(accountDataDate(typed)).toBe('2026-10-12');
    expect(accountDataDate(confirmed({}, '2026-10-20T15:00:00Z', '2026-10-13'))).toBe('2026-10-13');
  });
});

describe('cloud merge', () => {
  const local = confirmed();
  const remoteOld = { ...local, balance: 25_090 };
  it('an unsynced local save is kept over the older cloud row and uploaded again', () => {
    const r = mergeRemoteAccounts([local], [remoteOld], ['flex']);
    expect(r.accounts.map((a) => a.balance)).toEqual([25_246]);
    expect(r.reupload.map((a) => a.id)).toEqual(['flex']);
  });
  it('a synced account takes the cloud row (another device may have updated it)', () => {
    const r = mergeRemoteAccounts([local], [remoteOld], []);
    expect(r.accounts.map((a) => a.balance)).toEqual([25_090]);
    expect(r.reupload).toEqual([]);
  });
  it('an account created on this device and not uploaded yet is kept; a synced one deleted elsewhere is not', () => {
    const fresh = makeAccount({ id: 'new' });
    expect(mergeRemoteAccounts([fresh], [], ['new']).accounts.map((a) => a.id)).toEqual(['new']);
    expect(mergeRemoteAccounts([fresh], [], []).accounts).toEqual([]);
  });
});

describe('save read-back', () => {
  it('confirms only an identical stored copy', () => {
    const a = confirmed();
    expect(verifyPersisted(a, structuredClone(a))).toBeNull();
    expect(verifyPersisted(a, { ...a, balance: 25_090 })).toMatch(/balance/);
    expect(verifyPersisted(a, undefined)).toMatch(/not found/);
    expect(verifyPersisted(a, { ...a, importState: { ...a.importState!, threshold: { value: 24_000, source: 'manual', at: '' } } })).toMatch(/threshold/);
  });
  it('update history (with undo data) round-trips through the database row', () => {
    const a = confirmed();
    a.importState!.history = [{ id: 'r1', at: '2026-10-13T15:00:00Z', engine: 'ocr', pages: 1, fields: [], before: { balance: 25_090, highWaterMark: 25_270 }, after: { balance: 25_246, highWaterMark: 25_270 }, notes: [], previous: { balance: 25_090, highWaterMark: 25_270, startingBalance: 25_000, cycleStartBalance: 25_000, status: 'active', rules: a.rules, threshold: null, reported: null, origins: null }, undoneAt: '2026-10-13T16:00:00Z' }];
    const { account, rules } = accountToRows(a, 'u');
    expect(rowsToAccount(JSON.parse(JSON.stringify(account)), JSON.parse(JSON.stringify(rules))).importState?.history).toEqual(a.importState!.history);
  });

  it('the database row round-trips balance, start, floor and update time', () => {
    const a = confirmed();
    const { account, rules } = accountToRows(a, 'u');
    const back = rowsToAccount({ ...account, updated_at: '2026-10-13T15:00:01Z' }, rules);
    expect(verifyPersisted(a, back)).toBeNull();
    expect(back.updatedAt).toBe('2026-10-13T15:00:01Z');
  });
});
