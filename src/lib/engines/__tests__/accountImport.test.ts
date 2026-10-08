import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { makeAccount } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import {
  applyImport,
  confirmImport,
  extractPage,
  fingerprintOf,
  looksLikeAccountId,
  maskId,
  matchImport,
  parseDate,
  parseMoney,
  reconcile,
  type Extraction,
  type FieldKey,
  type OcrPage,
} from '../accountImport';
import { drawdownBuffer, drawdownFloor } from '../propRuleEngine';

import blurry from './fixtures/accountScreenshots/blurry.json';
import generic from './fixtures/accountScreenshots/generic.json';
import lucidDetails from './fixtures/accountScreenshots/lucid-details.json';
import lucid from './fixtures/accountScreenshots/lucid.json';
import topstep from './fixtures/accountScreenshots/topstep.json';

/**
 * Fixtures are REAL Tesseract (tesseract.js, eng best_int) output for
 * synthetic dashboard layouts: Lucid-style card grid, a Lucid-style details
 * table, a Topstep-style table, a generic "net liq / trailing drawdown"
 * layout, and a blurry, low-resolution photo.
 */
const db = FIRM_RULES_SEED;
const firms = db.firms;
const TODAY = '2026-10-08';
const run = (...pages: OcrPage[]): Extraction => reconcile(pages.map((p, i) => extractPage(p, i, { firms })));
const v = (x: Extraction, k: FieldKey) => x.fields[k]?.value;
/** Replace a value everywhere in an OCR page (line text AND word tokens). */
const swap = (page: unknown, ...pairs: [string, string][]): OcrPage => JSON.parse(pairs.reduce((s, [a, b]) => s.split(a).join(b), JSON.stringify(page)));

describe('token parsing', () => {
  it('money: currency, separators, signs, parentheses, OCR O→0; rejects ids and dates', () => {
    expect(parseMoney('$51,240.50')).toBe(51240.5);
    expect(parseMoney('+$1,240.50')).toBe(1240.5);
    expect(parseMoney('-$500')).toBe(-500);
    expect(parseMoney('(1,880.00)')).toBe(-1880);
    expect(parseMoney('2,O00.00')).toBe(2000);
    expect(parseMoney('50K')).toBeNull();
    expect(parseMoney('50K', true)).toBe(50000);
    expect(parseMoney('LT-50K-284917')).toBeNull();
    expect(parseMoney('09/15/2026')).toBeNull();
    expect(parseMoney('Active')).toBeNull();
  });

  it('dates and account ids', () => {
    expect(parseDate(['09/15/2026'])?.iso).toBe('2026-09-15');
    expect(parseDate(['2026-10-08'])?.iso).toBe('2026-10-08');
    expect(parseDate(['Sep', '15,', '2026'])?.iso).toBe('2026-09-15');
    expect(parseDate(['13/45/2026'])).toBeNull();
    expect(looksLikeAccountId('LT-50K-284917')).toBe(true);
    expect(looksLikeAccountId('50,812.25')).toBe(false);
    expect(looksLikeAccountId('LucidPro')).toBe(false);
    expect(maskId('LT-50K-284917')).toBe('••••4917');
    expect(fingerprintOf('lt-50k-284917')).toBe(fingerprintOf('LT 50K 284917'));
    expect(fingerprintOf('LT-50K-284917')).not.toContain('284917');
  });
});

describe('extraction — Lucid-style card grid (labels above values)', () => {
  const x = run(lucid as OcrPage);

  it('reads each card into the right field; balance, max drawdown and threshold stay distinct', () => {
    expect(v(x, 'firm')).toBe('Lucid Trading');
    expect(v(x, 'balance')).toBe(51240.5);
    expect(v(x, 'startingBalance')).toBe(50000);
    expect(v(x, 'netPnl')).toBe(1240.5);
    expect(v(x, 'maxDrawdown')).toBe(2000);
    expect(v(x, 'drawdownThreshold')).toBe(49340);
    expect(v(x, 'dailyLossLimit')).toBe(1200);
    expect(v(x, 'accountSize')).toBe(50000);
    expect(v(x, 'stage')).toBe('evaluation');
    expect(v(x, 'status')).toBe('Active');
  });

  it('remaining drawdown is CALCULATED (balance − threshold) and labelled as such', () => {
    expect(x.fields.drawdownRemaining).toMatchObject({ value: 1900.5, source: 'derived' });
    expect(x.fields.drawdownRemaining!.evidence).toMatch(/Calculated/);
  });

  it('arithmetic agreement raises a low OCR reading (green "+$1,240.50")', () => {
    expect(x.checks.find((c) => c.id === 'start-pnl-balance')?.status).toBe('consistent');
    expect(x.fields.netPnl!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('account number and email are detected as sensitive, masked, fingerprinted — never stored raw', () => {
    expect(x.sensitive.map((s) => s.kind).sort()).toEqual(['account_id', 'email']);
    const id = x.sensitive.find((s) => s.kind === 'account_id')!;
    expect(id.masked).toBe('••••4917');
    expect(id.bbox).not.toBeNull();
    expect(x.fingerprint).toBe(fingerprintOf('LT-50K-284917'));
    expect(JSON.stringify(x)).not.toContain('284917');
    expect(JSON.stringify(x)).not.toContain('trader@example.com');
  });
});

describe('multiple screenshots', () => {
  it('merges a details page; read remaining agrees with balance − threshold', () => {
    const x = run(lucid as OcrPage, lucidDetails as OcrPage);
    expect(x.fields.drawdownRemaining).toMatchObject({ value: 1900.5, source: 'ocr', page: 1 });
    expect(x.checks.find((c) => c.id === 'balance-threshold-remaining')?.status).toBe('consistent');
    expect(v(x, 'startDate')).toBe('2026-09-15');
    expect(x.pages).toHaveLength(2);
  });

  it('a disagreeing screenshot becomes a conflict with alternatives, not a silent overwrite', () => {
    const changed = swap(lucidDetails, ['$1,900.50', '$1,700.50']);
    const x = run(lucid as OcrPage, changed);
    expect(x.fields.drawdownRemaining!.confidence).toBeLessThanOrEqual(0.6);
    expect(x.checks.find((c) => c.id === 'balance-threshold-remaining')?.status).toBe('conflict');
  });
});

describe('extraction — other layouts', () => {
  it('Topstep-style table (label and value on one line)', () => {
    const x = run(topstep as OcrPage);
    expect(v(x, 'firm')).toBe('Topstep');
    expect(v(x, 'balance')).toBe(50812.25);
    expect(v(x, 'maxDrawdown')).toBe(2000);
    expect(x.fields.drawdownRemaining).toMatchObject({ value: 1812.25, source: 'ocr' });
    expect(x.fields.drawdownThreshold).toMatchObject({ value: 49000, source: 'derived' });
    expect(v(x, 'dailyLossLimit')).toBe(1000);
    expect(v(x, 'profitTarget')).toBe(3000);
    expect(v(x, 'statementDate')).toBe('2026-10-08');
    expect(v(x, 'stage')).toBe('evaluation');
    expect(x.sensitive[0]).toMatchObject({ kind: 'account_id', masked: '••••7890' });
  });

  it('generic layout: net liq = balance, trailing drawdown = max, drawdown used = current; two checks agree', () => {
    const x = run(generic as OcrPage);
    expect(v(x, 'balance')).toBe(101120);
    expect(v(x, 'maxDrawdown')).toBe(3000);
    expect(v(x, 'currentDrawdown')).toBe(1250);
    expect(v(x, 'drawdownThreshold')).toBe(99370);
    expect(v(x, 'netPnl')).toBe(-1880);
    expect(x.fields.drawdownRemaining).toMatchObject({ value: 1750, source: 'derived' });
    expect(x.checks.find((c) => c.id === 'used-remaining-max')?.status).toBe('consistent');
    expect(v(x, 'stage')).toBe('funded');
  });

  it('blurry photo: poor quality, no numbers invented', () => {
    const x = run(blurry as OcrPage);
    expect(x.pages[0].quality).toBe('poor');
    for (const k of ['balance', 'maxDrawdown', 'drawdownThreshold', 'drawdownRemaining', 'dailyLossLimit'] as FieldKey[]) expect(x.fields[k]).toBeUndefined();
    expect(x.fingerprint).toBeNull();
  });

  it('a "max drawdown" that looks like a balance is flagged, never trusted', () => {
    const page = swap(topstep, ['2,000.00', '48,000.00']);
    const x = run(page);
    expect(x.checks.find((c) => c.id === 'max-looks-like-balance')?.status).toBe('conflict');
    expect(x.fields.maxDrawdown!.confidence).toBeLessThan(0.5);
  });
});

describe('matching', () => {
  it('Lucid → LucidPro 50K Evaluation, DLL option inferred, verified rules compared', () => {
    const x = run(lucid as OcrPage);
    const m = matchImport(x, { db, accounts: [], today: TODAY, mode: 'new' });
    expect(m.rulesStatus).toBe('verified');
    expect(m.firm?.id).toBe('lucid');
    expect(m.program?.programId).toBe('lucid:pro-eval:50k');
    expect(m.options).toEqual({ dll: 'on' });
    expect(m.ruleComparisons.find((r) => r.field === 'maxDrawdown')).toMatchObject({ status: 'match', verified: 2000 });
    expect(m.ruleComparisons.find((r) => r.field === 'dailyLossLimit')).toMatchObject({ status: 'match', verified: 1200 });
    expect(m.duplicate).toBeNull();
  });

  it('the purchase date on the screenshot picks the rule version — no verified version, nothing claimed', () => {
    const m = matchImport(run(lucid as OcrPage, lucidDetails as OcrPage), { db, accounts: [], today: TODAY, mode: 'new' });
    expect(m.program?.programId).toBe('lucid:pro-eval:50k');
    expect(m.ruleDate).toBe('2026-09-15');
    expect(m.rulesStatus).toBe('not_verified');
    expect(m.ruleComparisons).toEqual([]);
    expect(m.rulesNote).toMatch(/No verified .* purchase date of 2026-09-15/);
  });

  it('Topstep → 50K Trading Combine', () => {
    const m = matchImport(run(topstep as OcrPage), { db, accounts: [], today: TODAY, mode: 'new' });
    expect(m.program?.programId).toBe('topstep:trading-combine:50k');
  });

  it('screenshot rule values that differ from verified rules are reported, verified rule kept', () => {
    const page = swap(lucid, ['$2,000.00', '$2,500.00']);
    const m = matchImport(run(page), { db, accounts: [], today: TODAY, mode: 'new' });
    expect(m.ruleComparisons.find((r) => r.field === 'maxDrawdown')).toMatchObject({ status: 'differs', screenshot: 2500, verified: 2000 });
    expect(m.conflicts.some((c) => /verified rule is kept/.test(c.message))).toBe(true);
  });

  it('duplicates: same account number → update existing; same configuration → warning', () => {
    const x = run(lucid as OcrPage);
    const existing = makeAccount({ id: 'a1', name: 'My Lucid', importState: { fingerprint: x.fingerprint, maskedId: null, reported: null, history: [] } });
    const m = matchImport(x, { db, accounts: [existing], today: TODAY, mode: 'new' });
    expect(m.duplicate).toMatchObject({ accountId: 'a1', reason: 'same_account_number' });
    const sameConfig = makeAccount({ id: 'a2', name: 'Lucid 50K', firmLink: { programId: 'lucid:pro-eval:50k' } as never });
    const m2 = matchImport({ ...x, fingerprint: null }, { db, accounts: [sameConfig], today: TODAY, mode: 'new' });
    expect(m2.duplicate).toMatchObject({ accountId: 'a2', reason: 'same_configuration' });
  });

  it('updating an account with a screenshot of a different account asks for confirmation', () => {
    const target = makeAccount({ id: 't', name: 'Topstep 100K', firm: 'Topstep', size: 100000, firmLink: { stage: 'evaluation', programId: 'topstep:trading-combine:100k' } as never });
    const m = matchImport(run(lucid as OcrPage), { db, accounts: [target], target, today: TODAY, mode: 'update' });
    const fields = m.conflicts.filter((c) => c.severity === 'conflict').map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(['firm', 'accountSize']));
  });
});

describe('apply (after confirmation)', () => {
  /** LucidPro 50K Evaluation as the verified loader saves it: EOD trailing $2,000, locks at start + $100. */
  const lucidAccount = (over: Partial<Account> = {}): Account =>
    makeAccount({
      id: 'lucid',
      size: 50000,
      startingBalance: 50000,
      balance: 50000,
      cycleStartBalance: 50000,
      highWaterMark: 50000,
      firmLink: { status: 'verified', overrides: [], calc: { trailingLockOffset: 100 }, stage: 'evaluation', programId: 'lucid:pro-eval:50k' } as never,
      ...over,
      rules: { maxDrawdown: 2000, drawdownType: 'eod_trailing', dailyLossLimit: 1200, profitTarget: 3000, maxContracts: 4, trailingLocksAtStart: false, calc: { trailingLockOffset: 100 } } as never,
    });
  const confirmFrom = (x: Extraction, edited: FieldKey[] = [], ruleUpdates = {}) =>
    confirmImport({ fields: x.fields, edited: new Set(edited), ruleUpdates, fingerprint: x.fingerprint, maskedId: null, engine: 'ocr', pages: x.pages.length, now: new Date('2026-10-08T16:00:00Z') });

  it('updates balance and drawdown tracking so the program rules reproduce the firm threshold', () => {
    const x = run(lucid as OcrPage);
    const r = applyImport(lucidAccount(), confirmFrom(x), 'imp1');
    expect(r.account.balance).toBe(51240.5);
    expect(r.account.highWaterMark).toBe(51340);
    expect(drawdownFloor(r.account)).toBe(49340);
    expect(drawdownBuffer(r.account)).toBe(1900.5);
    expect(r.floorCheck).toMatchObject({ reported: 49340, calculated: 49340, matches: true });
    expect(r.account.importState?.reported).toMatchObject({ balance: 51240.5, drawdownThreshold: 49340, drawdownRemaining: 1900.5 });
    expect(r.account.importState?.fingerprint).toBe(x.fingerprint);
    expect(r.record.before).toEqual({ balance: 50000, highWaterMark: 50000 });
  });

  it('a locked trailing floor keeps the known peak', () => {
    const page = swap(lucid, ['$49,340.00', '$50,100.00'], ['$51,240.50', '$52,900.00'], ['+$1,240.50', '+$2,900.00']);
    const r = applyImport(lucidAccount({ highWaterMark: 53000, balance: 53000 }), confirmFrom(run(page)), 'imp');
    expect(drawdownFloor(r.account)).toBe(50100);
    expect(r.account.highWaterMark).toBeGreaterThanOrEqual(53000);
  });

  it('never overwrites verified rules; unverified accounts take rule values only when chosen', () => {
    const x = run(lucid as OcrPage);
    const r = applyImport(lucidAccount(), confirmFrom(x, [], { maxDrawdown: 2500 }), 'i');
    expect(r.account.rules.maxDrawdown).toBe(2000);
    const manual = makeAccount({ size: 50000, startingBalance: 50000, balance: 50000, highWaterMark: 50000, rules: { maxDrawdown: null, dailyLossLimit: null } as never });
    expect(applyImport(manual, confirmFrom(x), 'i').account.rules.maxDrawdown).toBeNull();
    expect(applyImport(manual, confirmFrom(x, [], { maxDrawdown: 2000 }), 'i').account.rules.maxDrawdown).toBe(2000);
  });

  it('edited values are recorded as the trader’s, history is kept and capped, no image data stored', () => {
    const x = run(lucid as OcrPage);
    x.fields.balance = { ...x.fields.balance!, value: 51200 };
    let acc = lucidAccount();
    for (let i = 0; i < 35; i++) acc = applyImport(acc, confirmFrom(x, ['balance']), `i${i}`).account;
    expect(acc.importState!.history).toHaveLength(30);
    const f = acc.importState!.history[0].fields.find((y) => y.key === 'balance')!;
    expect(f).toMatchObject({ value: 51200, source: 'user', edited: true, confidence: null });
    expect(JSON.stringify(acc.importState)).not.toMatch(/base64|data:image|284917/);
  });

  it('mismatch between firm threshold and program rules is reported, not hidden', () => {
    const x = run(lucid as OcrPage);
    const wrongRules = lucidAccount();
    wrongRules.rules = { ...wrongRules.rules, drawdownType: 'static' };
    const r = applyImport(wrongRules, confirmFrom(x), 'i');
    expect(r.floorCheck?.matches).toBe(false);
    expect(r.record.notes.join(' ')).toMatch(/Check the drawdown rules/);
  });
});
