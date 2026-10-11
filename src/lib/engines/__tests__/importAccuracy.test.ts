/**
 * Screenshot import accuracy and drawdown safety — acceptance tests A–L.
 *
 * Root cause of the reported "$66 profit target" (Lucid 25K, balance $24,934):
 * every unsigned money field was stored as Math.abs(value), so the −$66.00
 * shown on / under a "Profit target" card (the progress toward the target, or
 * total P&L) became a $66 target. Both real-OCR layouts below produced 66
 * before the fix.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { createAccountFromImport } from '@/features/accountImport/createAccount';
import { rejectReason } from '@/services/accountImport/validate';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';
import { makeAccount, makeRules } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import {
  ADDITIONAL_INFO_REQUIRED,
  applyImport,
  buildReview,
  confirmImport,
  crossCheck,
  extractPage,
  LOW_CONFIDENCE,
  matchImport,
  mergeAmbiguous,
  mergePages,
  reconcile,
  screenshotChecks,
  type ExtractedField,
  type FieldKey,
  type FieldMap,
  type OcrPage,
  type ReviewInput,
} from '../accountImport';
import { computeDailyGuard } from '../dailyGuardEngine';
import { getProgram, importProgramRules } from '../firmRulesEngine';
import { drawdownBuffer, drawdownFloor } from '../propRuleEngine';

import progress from './fixtures/accountScreenshots/lucid-progress.json';
import progressOnly from './fixtures/accountScreenshots/lucid-target-progress-only.json';
import nll from './fixtures/accountScreenshots/lucidflex-nll.json';
import overview from './fixtures/accountScreenshots/lucidflex-overview.json';

const db = FIRM_RULES_SEED;
const firms = db.firms;
const TODAY = '2026-10-11';
const NOW = new Date('2026-10-11T14:00:00Z');

/** What the screen does: read pages, apply edits, cross-check, match, build the review. */
function state(pages: unknown[], edits: Partial<Record<FieldKey, number>> = {}, chosen: Record<string, string> = {}, over: Partial<ReviewInput> = {}, programId: string | null = null) {
  const exts = pages.map((p, i) => extractPage(p as OcrPage, i, { firms }));
  const merged: FieldMap = mergePages(exts);
  for (const [k, v] of Object.entries(edits)) merged[k as FieldKey] = { key: k as FieldKey, value: v, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 } satisfies ExtractedField;
  const cc = crossCheck(merged);
  const checks = [...screenshotChecks(exts), ...cc.checks];
  const ambiguous = mergeAmbiguous(exts, cc.fields);
  const extraction = { ...reconcile(exts), fields: cc.fields, checks, ambiguous };
  const match = matchImport(extraction, { db, accounts: [], target: null, today: TODAY, mode: 'new', programId });
  const program = match.program ? getProgram(db, match.program.programId) : null;
  const options = { ...match.options, ...chosen };
  const imp = program ? importProgramRules(program, match.ruleDate, options) : null;
  const verifiedRules: ReviewInput['verifiedRules'] = {};
  if (imp?.status === 'verified') for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) if (imp.values[k]) verifiedRules[k] = Number(imp.values[k]);
  const t = imp?.status === 'verified' ? imp.values.drawdownType : null;
  const model = buildReview({
    mode: 'new',
    fields: cc.fields,
    checks,
    match,
    verifiedRules,
    locked: new Set(),
    edited: new Set(Object.keys(edits) as FieldKey[]),
    confirmedFields: new Set(),
    acks: {},
    missingOptions: [],
    name: 'Lucid 25K',
    programSize: program?.accountSize ?? null,
    programName: program?.name ?? null,
    ambiguous,
    verifiedDrawdownType: t === 'static' || t === 'trailing' || t === 'eod_trailing' ? t : null,
    ...over,
  });
  return { exts, fields: cc.fields, checks, ambiguous, extraction, match, program, options, imp, model };
}
const card = (m: ReturnType<typeof buildReview>, k: string) => m.summary.find((c) => c.key === k)!;
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

describe('A: current balance', () => {
  it('reads $24,934 and shows it as extracted — never as verified', () => {
    const s = state([progress]);
    expect(s.fields.balance).toMatchObject({ value: 24_934, source: 'ocr' });
    expect(card(s.model, 'balance')).toMatchObject({ value: 24_934, status: 'extracted', editable: true });
    expect(card(s.model, 'balance').statusLabel).toMatch(/Extracted — needs confirmation/);
  });
});

describe('B: a −$66 is never a profit target', () => {
  it('a bare −$66.00 under "Profit target" (real OCR) → target missing, flagged for review, nothing invented', () => {
    const s = state([progressOnly]);
    expect(s.fields.profitTarget).toBeUndefined();
    expect(s.fields.profitTargetBalance).toBeUndefined();
    expect(s.ambiguous).toEqual([expect.objectContaining({ key: 'profitTarget', value: -66 })]);
    const t = card(s.model, 'profitTarget');
    expect(t).toMatchObject({ value: null, status: 'review', needsReview: true });
    expect(t.note).toMatch(/negative amount .* cannot be the profit target/);
    expect(s.model.notice).toMatch(/Profit Target/);
  });

  it('"−$66.00 / $1,250.00" progress (real OCR) → target $1,250; the −$66 progress is not the target', () => {
    const s = state([progress]);
    expect(s.fields.profitTarget?.value).toBe(1_250);
    expect(s.ambiguous?.[0]).toMatchObject({ key: 'profitTarget', value: -66 });
    expect(s.ambiguous?.[0].reason).toMatch(/Progress/);
  });

  it('same-line "Profit Target -$66.00" → not assigned; a loss limit printed negative is kept as an amount but must be confirmed', () => {
    const s = state([page(['Balance $24,934.00', 'Profit Target -$66.00', 'Daily Loss Limit -$600.00'])]);
    expect(s.fields.profitTarget).toBeUndefined();
    expect(s.fields.dailyLossLimit?.value).toBe(600);
    expect(s.fields.dailyLossLimit!.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(card(s.model, 'dailyLossLimit').status).toBe('review');
  });

  it('negative values are preserved where they mean something: P&L and remaining drawdown', () => {
    const s = state([page(['Balance $24,934.00', 'Net P&L -$66.00', "Today's P&L -$120.00", 'Remaining Drawdown -$40.00'])]);
    expect([s.fields.netPnl?.value, s.fields.dailyPnl?.value, s.fields.drawdownRemaining?.value]).toEqual([-66, -120, -40]);
    expect(s.model.drawdown.status).toBe('breached');
  });
});

describe('C: start 25,000 and balance 24,934', () => {
  it('net P&L = −66 (calculated) — and $66 is NOT the target, remaining drawdown, daily loss or threshold', () => {
    const s = state([page(['LucidFlex 25K', 'Starting Balance $25,000.00', 'Balance $24,934.00'])]);
    expect(s.fields.netPnl).toMatchObject({ value: -66, source: 'derived' });
    for (const k of ['profitTarget', 'profitTargetBalance', 'drawdownRemaining', 'dailyLossLimit', 'drawdownThreshold', 'maxDrawdown', 'currentDrawdown'] as FieldKey[]) expect(s.fields[k]).toBeUndefined();
    const details = Object.fromEntries(s.model.details.map((d) => [d.key, d.value]));
    expect(details.netPnl).toBe('−$66.00');
  });

  it('the nominal size "25K" is never used as the starting balance or to derive a target balance', () => {
    const s = state([page(['LucidFlex 25K', 'Balance $24,934.00', 'Profit Target $1,250.00'])]);
    expect(s.fields.accountSize?.value).toBe(25_000);
    expect(s.fields.startingBalance).toBeUndefined();
    expect(s.fields.netPnl).toBeUndefined();
    expect(s.fields.profitTargetBalance).toBeUndefined();
  });
});

describe('D: missing drawdown information', () => {
  it('no threshold on the screenshot → remaining drawdown unavailable ("Additional account information required"), not guessed from "Lucid 25K"', () => {
    // No stage on the screenshot: Evaluation and Funded tie — nothing is picked until the trader chooses.
    expect(state([progress]).match.alternatives.slice(0, 2).map((a) => a.programId)).toEqual(['lucid:flex-eval:25k', 'lucid:flex-funded:25k']);
    expect(state([progress]).program).toBeNull();
    const s = state([progress], {}, { dll: 'on' }, {}, 'lucid:flex-eval:25k');
    expect(s.program?.id).toBe('lucid:flex-eval:25k');
    expect(card(s.model, 'profitTarget')).toMatchObject({ value: 1_250, status: 'verified' });
    // LucidFlex's verified rules leave the DLL amount open: the screenshot's $600 stays "needs confirmation".
    expect(card(s.model, 'dailyLossLimit')).toMatchObject({ value: 600, status: 'extracted' });
    expect(s.model.drawdown).toMatchObject({ status: 'unavailable', remaining: null, threshold: null });
    const r = card(s.model, 'drawdownRemaining');
    expect(r).toMatchObject({ value: null, status: 'missing', statusLabel: ADDITIONAL_INFO_REQUIRED, needsReview: true });
    // EOD trailing: a verified $1,000 allowance is not enough — the floor depends on the high-water mark.
    expect(r.note).toMatch(/trails your highest balance/);
    expect(s.model.notice).toMatch(/Remaining Drawdown/);
    // Optional for saving: confirm is not disabled for it.
    expect(s.model.blockers).toEqual([]);
  });
});

describe('E: verified drawdown calculations', () => {
  it('balance (entered) − liquidation threshold (screenshot) = $664; drawdown used = verified $1,000 − $664', () => {
    const s = state([nll], { balance: 24_934 }, { dll: 'on' });
    expect(s.model.drawdown).toMatchObject({ status: 'available', remaining: 664, threshold: 24_270, basis: 'calculated' });
    expect(card(s.model, 'drawdownRemaining')).toMatchObject({ value: 664, status: 'calculated' });
    expect(s.model.details.find((d) => d.key === 'currentDrawdown')?.value).toBe('$336.00');
    expect(s.model.details.find((d) => d.key === 'drawdownType')).toMatchObject({ value: 'End-of-day trailing', note: 'Verified firm rule' });
  });

  it('static drawdown with a verified allowance and a READ starting balance → threshold = start − allowance', () => {
    const s = state([page(['Starting Balance $50,000.00', 'Balance $49,500.00'])], {}, {}, { verifiedRules: { maxDrawdown: 2_000 }, verifiedDrawdownType: 'static' });
    expect(s.model.drawdown).toMatchObject({ status: 'available', threshold: 48_000, remaining: 1_500, basis: 'verified_static' });
    expect(card(s.model, 'drawdownRemaining').statusLabel).toBe('Calculated from verified inputs');
  });

  it('update: reuses the account’s saved floor, trailed to the new balance (never a lower floor)', () => {
    const acct = makeAccount({ balance: 25_200, highWaterMark: 25_300, rules: { maxDrawdown: 1_000, drawdownType: 'eod_trailing' } as never });
    const bal = 25_500;
    const floor = drawdownFloor({ ...acct, balance: bal, highWaterMark: Math.max(acct.highWaterMark, bal) });
    expect(floor).toBe(24_500);
    const s = state([page(['Balance $25,500.00'])], {}, {}, { mode: 'update', accountFloor: floor });
    expect(s.model.drawdown).toMatchObject({ remaining: 1_000, basis: 'account' });
    expect(card(s.model, 'drawdownRemaining').statusLabel).toBe('Calculated from your saved account');
  });
});

describe('F: screenshots of different accounts', () => {
  it('two account numbers in one import block saving', () => {
    const other = { ...overview, lines: (overview as OcrPage).lines.map((l) => ({ ...l, text: l.text.replace('LFE25K-0012345', 'LFE25K-0099999'), words: l.words.map((w) => (w.text === 'LFE25K-0012345' ? { ...w, text: 'LFE25K-0099999' } : w)) })) };
    const s = state([overview, other]);
    expect(s.checks.find((c) => c.id === 'different-accounts')).toBeDefined();
    expect(s.model.blockers.join(' ')).toMatch(/other account/);
    expect(s.model.issues.find((i) => i.id === 'c:different-accounts')).toBeUndefined();
  });
});

describe('G: manual corrections persist', () => {
  it('a corrected profit target and balance are saved, round-trip through storage, and are tagged as entered', () => {
    const s = state([progressOnly], { balance: 24_950, profitTarget: 1_250 }, { dll: 'on' }, {}, 'lucid:flex-eval:25k');
    expect(card(s.model, 'balance')).toMatchObject({ value: 24_950, status: 'entered' });
    const c = confirmImport({ fields: s.fields, edited: new Set<FieldKey>(['balance', 'profitTarget']), ruleUpdates: s.model.saveableRules, fingerprint: s.extraction.fingerprint, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = createAccountFromImport({ db, id: 'g1', name: 'Lucid 25K', firmName: 'Lucid Trading', programId: s.program!.id, options: s.options, ruleDate: s.match.ruleDate, confirmed: c, now: NOW });
    expect(r.ok).toBe(true);
    const a = (r as { ok: true; result: { account: Account } }).result.account;
    const rows = accountToRows(a, 'u1');
    const back = rowsToAccount(rows.account as never, rows.rules as never);
    expect(back.balance).toBe(24_950);
    expect(back.importState!.history[0].fields.find((f) => f.key === 'balance')).toMatchObject({ source: 'user', edited: true });
  });
});

describe('H: updating an existing account', () => {
  it('the same account number is detected as a duplicate; applying the update keeps the id and history (no new account)', () => {
    const x = reconcile([extractPage(overview as OcrPage, 0, { firms })]);
    const existing = makeAccount({ id: 'lucid-1', name: 'My Lucid', importState: { fingerprint: x.fingerprint!, maskedId: null, history: [] } as never });
    const m = matchImport(x, { db, accounts: [existing], target: null, today: TODAY, mode: 'new' });
    expect(m.duplicate).toMatchObject({ accountId: 'lucid-1', reason: 'same_account_number' });
    const c = confirmImport({ fields: x.fields, edited: new Set(), fingerprint: x.fingerprint, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = applyImport(existing, c, 'imp-1');
    expect(r.account.id).toBe('lucid-1');
    expect(r.account.name).toBe('My Lucid');
    expect(r.account.balance).toBe(24_934);
    expect(r.account.importState?.history).toHaveLength(1);
  });
});

describe('H2: no stale overwrite', () => {
  it('an update screenshot without a threshold keeps the account’s confirmed floor (never drops to a rule-only floor)', () => {
    const first = state([nll], { balance: 24_934 }, { dll: 'on' });
    const c1 = confirmImport({ fields: first.fields, edited: new Set<FieldKey>(['balance']), ruleUpdates: first.model.saveableRules, fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const made = createAccountFromImport({ db, id: 'h2', name: 'Lucid 25K', firmName: 'Lucid Trading', programId: first.program!.id, options: first.options, ruleDate: first.match.ruleDate, confirmed: c1, now: NOW });
    const a = (made as { ok: true; result: { account: Account } }).result.account;
    expect(drawdownFloor(a)).toBe(24_270);
    const x = reconcile([extractPage(progress as OcrPage, 0, { firms })]);
    expect(x.fields.drawdownThreshold).toBeUndefined();
    const r = applyImport(a, confirmImport({ fields: x.fields, edited: new Set(), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW }), 'u2');
    expect(drawdownFloor(r.account)).toBe(24_270);
    expect(r.account.importState?.reported?.drawdownThreshold).toBe(24_270);
    expect(r.record.notes.join(' ')).toMatch(/last confirmed floor/);
    // An explicit reset is the only way to start over.
    const reset = applyImport(a, confirmImport({ fields: x.fields, edited: new Set(), reset: true, fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW }), 'u3');
    expect(reset.account.importState?.reported?.drawdownThreshold).toBeNull();
  });
});

describe('I: extraction failure', () => {
  it('nothing read → "Extraction failed" (retry offered by the screen); entering values recovers', () => {
    const s = state([], {}, {}, { extractionFailed: true });
    expect(s.model.state).toBe('failed');
    const t = state([], { balance: 24_934 }, {}, { extractionFailed: true, programSize: 25_000 });
    expect(t.model.state).not.toBe('failed');
  });
});

describe('K: unverified risk inputs never become authoritative', () => {
  it('a prop account without a known floor: drawdown unknown, never SAFE, no buffer used', () => {
    const a = makeAccount({ rules: { maxDrawdown: null, drawdownType: null } as never });
    expect(drawdownBuffer(a)).toBeNull();
    const g = computeDailyGuard({ account: a, rules: makeRules(), trades: [], now: NOW });
    expect(g.drawdownUnknown).toBe(true);
    expect(g.status).not.toBe('SAFE');
    expect(g.reasons.join(' ')).toMatch(/Drawdown floor unknown/);
  });

  it('an uncertain balance blocks confirm until checked; a balance-sized "MLL" is never saved as max loss', () => {
    const s = state([overview]);
    s.fields.balance = { ...s.fields.balance!, confidence: 0.4 };
    const m = buildReview({ ...baseInput(s), fields: s.fields });
    expect(card(m, 'balance')).toMatchObject({ status: 'review', confirmKey: 'balance' });
    expect(m.blockers.join(' ')).toMatch(/current balance/);
    const mll = state([page(['Northwind Capital', 'MLL $24,270.00'])]);
    expect(mll.model.saveableRules.maxDrawdown).toBeUndefined();
  });
});

describe('L: privacy and unsafe uploads', () => {
  it('account numbers never appear in extraction output, evidence or ambiguous readings', () => {
    const s = state([progress, progressOnly]);
    const json = JSON.stringify({ x: s.extraction, a: s.ambiguous, m: s.model });
    expect(json).not.toContain('0012345');
    expect(s.extraction.sensitive.find((i) => i.kind === 'account_id')?.masked).toMatch(/^••••/);
  });

  it('unsupported, empty, oversized and tiny files are refused before reading', () => {
    expect(rejectReason({ name: 'x.pdf', type: 'application/pdf', bytes: 1000 })).toMatch(/not supported/);
    expect(rejectReason({ name: 'x.png', type: 'image/png', bytes: 0 })).toMatch(/empty/);
    expect(rejectReason({ name: 'x.png', type: 'image/png', bytes: 40_000_000 })).toMatch(/larger than/);
    expect(rejectReason({ name: 'x.png', type: 'image/png', bytes: 1000, width: 40, height: 30 })).toMatch(/too small/);
    expect(rejectReason({ name: 'x.svg', type: 'image/svg+xml', bytes: 1000 })).toMatch(/not supported/);
  });
});

function baseInput(s: ReturnType<typeof state>): ReviewInput {
  return { mode: 'new', fields: s.fields, checks: s.checks, match: s.match, verifiedRules: {}, locked: new Set(), edited: new Set(), confirmedFields: new Set(), acks: {}, missingOptions: [], name: 'X', programSize: null, programName: null };
}
