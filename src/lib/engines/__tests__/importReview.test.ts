/**
 * The simplified review (essential rows + "Confirm & Save Account") and the
 * financial-safety rules behind it, on the real-OCR Lucid 25K case:
 * TOTAL P&L −$66 and NLL $24,270, no balance on the screenshot.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { createAccountFromImport } from '@/features/accountImport/createAccount';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';
import { makeAccount } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import { buildReview, confirmImport, rowsNeedingInput, crossCheck, extractPage, matchImport, mergePages, reconcile, type ExtractedField, type FieldKey, type FieldMap, type OcrPage, type ReviewInput } from '../accountImport';
import { getProgram, importProgramRules } from '../firmRulesEngine';
import { drawdownBuffer, drawdownFloor } from '../propRuleEngine';

import nll from './fixtures/accountScreenshots/lucidflex-nll.json';
import overview from './fixtures/accountScreenshots/lucidflex-overview.json';

const db = FIRM_RULES_SEED;
const firms = db.firms;
const TODAY = '2026-10-10';
const NOW = new Date('2026-10-10T20:05:00Z');

/** What the screen does: read pages, apply the trader's edits, cross-check. */
function reviewState(pages: unknown[], edits: Partial<Record<FieldKey, number>> = {}, chosen: Record<string, string> = {}) {
  const exts = pages.map((p, i) => extractPage(p as OcrPage, i, { firms }));
  const merged: FieldMap = mergePages(exts);
  for (const [k, v] of Object.entries(edits)) merged[k as FieldKey] = { key: k as FieldKey, value: v, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 } satisfies ExtractedField;
  const { fields, checks } = crossCheck(merged);
  const extraction = { ...reconcile(exts), fields, checks };
  const match = matchImport(extraction, { db, accounts: [], target: null, today: TODAY, mode: 'new' });
  const program = match.program ? getProgram(db, match.program.programId) : null;
  const options = { ...match.options, ...chosen };
  const imp = program ? importProgramRules(program, match.ruleDate, options) : null;
  const verifiedRules: ReviewInput['verifiedRules'] = {};
  if (imp?.status === 'verified') for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) if (imp.values[k]) verifiedRules[k] = Number(imp.values[k]);
  return { fields, checks, extraction, match, program, imp, options, verifiedRules, edited: new Set(Object.keys(edits) as FieldKey[]) };
}
const review = (s: ReturnType<typeof reviewState>, over: Partial<ReviewInput> = {}) =>
  buildReview({
    mode: 'new',
    fields: s.fields,
    checks: s.checks,
    match: s.match,
    verifiedRules: s.verifiedRules,
    locked: new Set(),
    edited: s.edited,
    confirmedFields: new Set(),
    acks: {},
    missingOptions: [],
    name: 'Lucid Trading LucidFlex 25K Evaluation',
    programSize: s.program?.accountSize ?? null,
    programName: s.program?.name ?? null,
    ...over,
  });
const row = (m: ReturnType<typeof buildReview>, k: FieldKey) => m.rows.find((r) => r.key === k);

describe('Lucid 25K: total P&L −$66 and NLL $24,270 (no balance on the screenshot)', () => {
  it('NLL is the liquidation threshold — never a max drawdown allowance; P&L is not the balance; nothing invented', () => {
    const s = reviewState([nll]);
    expect(s.fields.drawdownThreshold?.value).toBe(24_270);
    expect(s.fields.netPnl?.value).toBe(-66);
    expect(s.fields.maxDrawdown).toBeUndefined();
    expect(s.fields.balance).toBeUndefined(); // not 24,934 (25,000 − 66) and not the 25,000 size
    expect(s.fields.drawdownRemaining).toBeUndefined(); // no balance → no buffer
  });

  it('the DLL option is not on this screenshot: verified rules wait for the choice — no allowance is guessed meanwhile', () => {
    const s = reviewState([nll]);
    expect(s.imp?.status).toBe('needs_options');
    const m = review(s, { missingOptions: [{ id: 'dll', label: 'Daily Loss Limit' }] });
    expect(row(m, 'maxDrawdown')).toBeUndefined();
    expect(m.blockers).toContain('Choose the Daily Loss Limit option.');
  });

  it('review card: balance "Not detected" and required, liquidation from the screenshot, allowance from the VERIFIED rule', () => {
    const s = reviewState([nll], {}, { dll: 'on' });
    expect(s.match.program?.programId).toBe('lucid:flex-eval:25k');
    const m = review(s);
    expect(row(m, 'balance')).toMatchObject({ value: null, status: 'missing', required: true });
    expect(row(m, 'netPnl')).toMatchObject({ value: -66, source: 'screenshot' });
    expect(row(m, 'drawdownThreshold')).toMatchObject({ value: 24_270, source: 'screenshot', screenshot: 1 });
    expect(row(m, 'drawdownRemaining')).toBeUndefined();
    expect(row(m, 'maxDrawdown')).toMatchObject({ value: 1_000, source: 'verified_rule' });
    expect(row(m, 'accountSize')).toMatchObject({ value: 25_000, source: 'verified_rule' });
    expect(m.saveableRules.maxDrawdown).toBeUndefined();
    expect(m.blockers).toContain('Enter the current balance.');
  });

  it('after the trader enters the balance: buffer = balance − NLL (calculated), save is allowed', () => {
    const s = reviewState([nll], { balance: 24_934 }, { dll: 'on' });
    const m = review(s);
    expect(row(m, 'balance')).toMatchObject({ value: 24_934, source: 'edited', status: 'ok' });
    expect(row(m, 'drawdownRemaining')).toMatchObject({ value: 664, source: 'calculated' });
    expect(m.blockers).toEqual([]);
  });

  it('Confirm & Save Account: max loss = verified $1,000 (not $24,270), floor $24,270, buffer $664, entered balance kept — and it persists', () => {
    const s = reviewState([nll], { balance: 24_934 }, { dll: 'on' });
    const c = confirmImport({ fields: s.fields, edited: s.edited, ruleUpdates: review(s).saveableRules, fingerprint: s.extraction.fingerprint, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = createAccountFromImport({ db, id: 'acc-1', name: 'My Lucid 25K', firmName: 'Lucid Trading', programId: s.program!.id, options: s.options, ruleDate: s.match.ruleDate, confirmed: c, now: NOW });
    expect(r.ok).toBe(true);
    const a = (r as { ok: true; result: { account: Account } }).result.account;
    expect(a.rules.maxDrawdown).toBe(1_000);
    expect(a.balance).toBe(24_934);
    expect([drawdownFloor(a), drawdownBuffer(a)]).toEqual([24_270, 664]);
    expect(a.name).toBe('My Lucid 25K');
    expect(a.firmLink?.programId).toBe('lucid:flex-eval:25k');
    const rows = accountToRows(a, 'u1');
    const back = rowsToAccount(rows.account as never, rows.rules as never);
    expect([back.balance, back.rules.maxDrawdown, drawdownFloor(back), drawdownBuffer(back)]).toEqual([24_934, 1_000, 24_270, 664]);
    expect(back.importState?.reported).toMatchObject({ netPnl: -66, drawdownThreshold: 24_270 });
    // Provenance kept internally: the balance was typed by the trader, the NLL read from the screenshot.
    const fieldsOf = back.importState!.history[0].fields;
    expect(fieldsOf.find((f) => f.key === 'balance')).toMatchObject({ source: 'user', edited: true });
    expect(fieldsOf.find((f) => f.key === 'drawdownThreshold')).toMatchObject({ source: 'ocr', edited: false });
    // Rules known from the verified program are not listed as "unknown".
    expect(back.importState?.reported?.missing).not.toEqual(expect.arrayContaining(['maxDrawdown']));
    expect(back.importState?.reported?.missing).not.toEqual(expect.arrayContaining(['profitTarget']));
  });

  it('saving without a balance is refused — the size or P&L is never used instead', () => {
    const s = reviewState([nll]);
    const c = confirmImport({ fields: s.fields, edited: s.edited, fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = createAccountFromImport({ db, id: 'x', name: 'X', firmName: 'Lucid Trading', programId: s.program!.id, options: s.match.options, ruleDate: s.match.ruleDate, confirmed: c, now: NOW });
    expect(r.ok).toBe(false);
  });
});

describe('financial safety rules', () => {
  const page = (lines: string[]): OcrPage => ({
    width: 800,
    height: lines.length * 40,
    confidence: 93,
    lines: lines.map((t, i) => {
      let x = 10;
      const words = t.split(' ').map((w) => {
        const bbox = { x0: x, y0: i * 40, x1: x + w.length * 10, y1: i * 40 + 16 };
        x += w.length * 10 + 10;
        return { text: w, confidence: 93, bbox };
      });
      return { text: t, confidence: 93, bbox: { x0: 10, y0: i * 40, x1: x, y1: i * 40 + 16 }, words };
    }),
  });

  it('an "MLL" that cannot be checked against a balance or size is never saved as max loss', () => {
    const s = reviewState([page(['Northwind Capital', 'MLL $24,270.00'])]);
    const m = review(s);
    expect(m.saveableRules.maxDrawdown).toBeUndefined();
    expect(m.rejected.map((r) => r.value)).toContain(24_270);
    expect(row(m, 'maxDrawdown')).toBeUndefined();
  });

  it('starting balance + total P&L never becomes the balance', () => {
    const s = reviewState([page(['Starting Balance $25,000.00', 'Total P&L -$66.00'])]);
    expect(s.fields.balance).toBeUndefined();
    expect(row(review(s), 'balance')?.status).toBe('missing');
  });

  it('uncertain and conflicting essentials block saving until confirmed or picked', () => {
    const s = reviewState([overview], {});
    s.fields.balance = { ...s.fields.balance!, confidence: 0.4 };
    const m = review(s);
    expect(row(m, 'balance')?.status).toBe('uncertain');
    expect(m.blockers.join(' ')).toMatch(/current balance/);
    expect(review(s, { confirmedFields: new Set<FieldKey>(['balance']) }).blockers.join(' ')).not.toMatch(/current balance/);
    s.fields.balance = { ...s.fields.balance!, confidence: 0.9, alternatives: [{ value: 24_500, confidence: 0.9, page: 1 }] };
    expect(row(review(s), 'balance')).toMatchObject({ status: 'conflict', choices: [{ value: 24_934, screenshot: 1 }, { value: 24_500, screenshot: 2 }] });
  });

  it('update: a rule the account holds from a verified program is never replaced by a screenshot reading', () => {
    const s = reviewState([overview]);
    const target = makeAccount({ firmLink: { status: 'verified', overrides: [], imported: { dailyLossLimit: '600' } } as never, rules: { dailyLossLimit: 600 } as never });
    s.fields.dailyLossLimit = { ...s.fields.dailyLossLimit!, value: 900 };
    const m = review(s, { mode: 'update', locked: new Set(['dailyLossLimit']), verifiedRules: { dailyLossLimit: target.rules.dailyLossLimit! } });
    expect(row(m, 'dailyLossLimit')).toMatchObject({ value: 600, source: 'verified_rule' });
    expect(m.saveableRules.dailyLossLimit).toBeUndefined();
  });

  it('a purchase option the screenshot cannot show must be chosen before saving', () => {
    const s = reviewState([nll]);
    const m = review(s, { missingOptions: [{ id: 'dll', label: 'Daily Loss Limit' }] });
    expect(m.blockers).toContain('Choose the Daily Loss Limit option.');
  });
});

describe('every blocker can be resolved on the review card', () => {
  it('a corrected balance that no longer matches the screenshot P&L shows the P&L inline (edit / confirm)', () => {
    const read = reviewState([overview]);
    const bal = read.fields.balance?.value as number;
    const pnl = read.fields.netPnl?.value as number;
    expect(typeof bal).toBe('number');
    expect(typeof pnl).toBe('number');
    const s = reviewState([overview], { startingBalance: bal - pnl, balance: bal + 4 });
    const m = review(s, { edited: new Set<FieldKey>(['balance', 'startingBalance']) });
    expect(m.blockers).toContain('Check the total p&l — the reading is uncertain.');
    expect(rowsNeedingInput(m).map((r) => r.key)).toContain('netPnl');
    // Confirming it clears the blocker.
    const ok = review(s, { edited: new Set<FieldKey>(['balance', 'startingBalance']), confirmedFields: new Set<FieldKey>(['netPnl']) });
    expect(ok.blockers).not.toContain('Check the total p&l — the reading is uncertain.');
    expect(rowsNeedingInput(ok).map((r) => r.key)).not.toContain('netPnl');
  });
  it('values already on the four summary cards are not repeated', () => {
    const m = review(reviewState([overview]));
    const cards = new Set<string>(m.summary.map((c) => c.key));
    expect(rowsNeedingInput(m).some((r) => cards.has(r.key))).toBe(false);
  });
});
