/**
 * Regression — LucidFlex 25K dashboard PHOTOGRAPHED from a laptop screen (the attached
 * screenshot). The import read "LUCIDFLEX 36K" / $36,000, missed the $25,390 balance, took
 * a $5 minimum balance and kept the old $25,318 in the preview.
 *
 * `lucidflex-photo-account.json` / `lucidflex-photo-calendar.json` are the app's OWN OCR output
 * (`ocr.web.ts` recognize(), tesseract.js, two passes: 1× and 1.6×) for the two attached photos,
 * with the account number replaced. Tesseract misreads several digits on these photos
 * ("35K"/"26K", "$25,300", "$26,280", "1" trading day); the tests pin down that such misreads
 * are never saved as values — they are resolved by arithmetic between values read elsewhere,
 * or left for the trader to correct.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { makeAccount } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import {
  applyImport,
  buildReview,
  confirmImport,
  crossCheck,
  extractPage,
  matchImport,
  mergeAmbiguous,
  mergePages,
  offeredSizes,
  screenshotChecks,
  type ExtractedField,
  type Extraction,
  type FieldKey,
  type FieldMap,
  type OcrPage,
  type ReviewInput,
  lockedRuleFields,
} from '../accountImport';
import { compareUpdate, providedFigures } from '../accountUpdate';
import { getProgram, importProgramRules } from '../firmRulesEngine';
import { drawdownBuffer, drawdownFloor } from '../propRuleEngine';

import account from './fixtures/accountScreenshots/lucidflex-photo-account.json';
import calendar from './fixtures/accountScreenshots/lucidflex-photo-calendar.json';
import blurry from './fixtures/accountScreenshots/blurry.json';
import topstep from './fixtures/accountScreenshots/topstep.json';

const db = FIRM_RULES_SEED;
const TODAY = '2026-10-19';
const NOW = new Date('2026-10-19T21:00:00Z');
const photo = account as unknown as OcrPage;
const calendarPhoto = calendar as unknown as OcrPage;

/** What the import screen does (`useImportReview` + the review inputs of `/accounts/import`). */
function screen(pages: OcrPage[], opts: { target?: Account | null; edits?: Partial<Record<FieldKey, number>>; /** "Looks right" taps on uncertain readings. */ looksRight?: FieldKey[] } = {}) {
  const target = opts.target ?? null;
  const mode = target ? 'update' : 'new';
  const exts = pages.map((p, i) => extractPage(p, i, { firms: db.firms }));
  const merged: FieldMap = mergePages(exts);
  for (const [k, v] of Object.entries(opts.edits ?? {})) merged[k as FieldKey] = { key: k as FieldKey, value: v, confidence: 1, source: 'user', evidence: 'Entered by you', page: -1 } satisfies ExtractedField;
  const firmName = target ? target.firm : typeof merged.firm?.value === 'string' ? merged.firm.value : null;
  const cc = crossCheck(merged, { context: { sizes: offeredSizes(db, firmName), firmName, account: target ? { size: target.size, startingBalance: target.startingBalance } : null } });
  const ambiguous = [...mergeAmbiguous(exts, cc.fields), ...cc.ambiguous];
  const sensitive = exts.flatMap((p) => p.sensitive);
  const extraction: Extraction = { fields: cc.fields, ambiguous, checks: [...screenshotChecks(exts), ...cc.checks], sensitive, pages: [], fingerprint: sensitive.find((s) => s.fingerprint)?.fingerprint ?? null };
  const match = matchImport(extraction, { db, accounts: target ? [target] : [], target, today: TODAY, mode });
  const program = mode === 'new' && match.program ? getProgram(db, match.program.programId) : null;
  const imp = program ? importProgramRules(program, match.ruleDate, match.options) : null;
  const locked: Set<string> = target ? lockedRuleFields(target) : new Set<string>();
  const verifiedRules: ReviewInput['verifiedRules'] = {};
  for (const k of ['maxDrawdown', 'dailyLossLimit', 'profitTarget'] as const) {
    const v = mode === 'new' ? (imp?.status === 'verified' && imp.values[k] ? Number(imp.values[k]) : null) : locked.has(k) ? target!.rules[k] : null;
    if (v != null) verifiedRules[k] = v;
  }
  const edited = new Set(Object.keys(opts.edits ?? {}) as FieldKey[]);
  const model = buildReview({
    mode,
    fields: cc.fields,
    checks: extraction.checks,
    match,
    verifiedRules,
    locked,
    edited,
    confirmedFields: new Set(opts.looksRight ?? []),
    acks: {},
    missingOptions: [],
    name: 'LucidFlex 25K',
    programSize: program?.accountSize ?? null,
    programName: program?.name ?? null,
    ambiguous,
  });
  const values = { ...cc.fields };
  if (program?.accountSize) values.accountSize = { key: 'accountSize', value: program.accountSize, confidence: 1, source: 'user', evidence: 'Program size', page: -1 };
  const confirmed = confirmImport({ fields: values, edited, fingerprint: extraction.fingerprint, maskedId: null, engine: 'ocr', pages: pages.length, now: NOW });
  return { fields: cc.fields, checks: extraction.checks, ambiguous, match, program, model, confirmed, extraction };
}
const v = (s: ReturnType<typeof screen>, k: FieldKey) => s.fields[k]?.value;

/** The saved LucidFlex 25K Evaluation before this screenshot: $25,318 balance, floor $24,330. */
const savedLucid = (): Account =>
  makeAccount({
    id: 'flex-25k',
    name: 'LucidFlex 25K Evaluation',
    firm: 'Lucid Trading',
    size: 25_000,
    startingBalance: 25_000,
    cycleStartBalance: 25_000,
    balance: 25_318,
    highWaterMark: 25_330,
    rules: { ...makeAccount().rules, maxDrawdown: 1_000, drawdownType: 'eod_trailing', dailyLossLimit: 600, profitTarget: 1_250 },
    importState: {
      fingerprint: null,
      maskedId: null,
      history: [],
      threshold: { value: 24_330, source: 'screenshot', at: '2026-10-16T21:00:00Z' },
      reported: { at: '2026-10-16T21:00:00Z', asOf: '2026-10-16', balance: 25_318, drawdownThreshold: 24_330 } as never,
    },
  });

describe('the attached LucidFlex photo, read by the app’s own OCR', () => {
  const s = screen([photo]);

  it('never takes a misread size: 35K / 26K are not LucidFlex sizes → needs confirmation; the program is 25K', () => {
    expect(v(s, 'accountSize')).toBeUndefined();
    expect(s.ambiguous.filter((a) => a.key === 'accountSize').map((a) => a.value).sort()).toEqual([26_000, 35_000]);
    expect(s.ambiguous.find((a) => a.key === 'accountSize')!.reason).toMatch(/not an account size Lucid Trading offers.*Needs confirmation/);
    // Start = balance − total P&L (two read values) = $25,000 → LucidFlex 25K Evaluation.
    expect(s.fields.startingBalance).toMatchObject({ value: 25_000, source: 'derived' });
    expect(s.match.program?.programId).toBe('lucid:flex-eval:25k');
    expect(s.model.rows.find((r) => r.key === 'accountSize')).toMatchObject({ value: 25_000, source: 'verified_rule' });
  });

  it('balance $25,390: the two readings ($25,390 / $25,300) are settled by minimum balance + drawdown, and the other reading is named', () => {
    expect(v(s, 'balance')).toBe(25_390);
    expect(s.fields.balance?.alternatives).toBeUndefined();
    expect(s.checks.find((c) => c.id === 'resolved:balance')?.message).toMatch(/\$25,390 and \$25,300.*agrees with minimum balance \+ the drawdown shown/);
  });

  it('every account metric sits in its own field, read next to its own label', () => {
    expect(v(s, 'netPnl')).toBe(390);
    expect(v(s, 'drawdownThreshold')).toBe(24_402);
    expect(v(s, 'drawdownRemaining')).toBe(988);
    expect(s.fields.drawdownRemaining?.evidence).toMatch(/DRAWDOWN.*equals balance − minimum balance/);
    expect(v(s, 'dailyLossLimit')).toBe(600);
    expect(v(s, 'profitRemaining')).toBe(860);
    expect(s.checks.find((c) => c.id === 'balance-threshold-remaining')?.status).toBe('consistent');
    // Chart axis ($24,000 … $25,600), calendar days and the account number never become metrics.
    for (const f of Object.values(s.fields)) if (typeof f?.value === 'number') expect([24_000, 24_200, 24_400, 24_600, 24_800, 25_000, 25_200, 25_400, 25_600].includes(f.value) && f.source !== 'derived').toBe(false);
    expect(JSON.stringify(s.fields)).not.toMatch(/7777777770002/);
  });

  it('values OCR could not agree on stay open: trading days 11 vs 1 must be picked', () => {
    expect(s.fields.tradingDays?.alternatives?.map((a) => a.value)).toBeDefined();
    expect([s.fields.tradingDays!.value, ...s.fields.tradingDays!.alternatives!.map((a) => a.value)].sort()).toEqual([1, 11]);
    expect(s.model.rows.find((r) => r.key === 'tradingDays')?.status).toBe('conflict');
    expect(s.model.blockers.join(' ')).toMatch(/Pick the correct trading days/);
  });

  it('a target balance that does not add up ($26,280 vs balance + remaining = $26,250) needs a correction, not “I checked this”', () => {
    const issue = s.model.issues.find((i) => i.id === 'c:balance-remaining-target');
    expect(issue).toMatchObject({ kind: 'fix' });
    expect(issue!.message).toMatch(/\$25,390.*\$860.*\$26,250.*\$26,280/);
    expect(s.model.blockers).toContain('Correct the values that do not add up (marked “Needs your attention”).');
    // Acknowledging it changes nothing.
    const acked = buildReview({ ...reviewInput(s), acks: { [issue!.id]: true } });
    expect(acked.blockers).toContain('Correct the values that do not add up (marked “Needs your attention”).');
  });

  it('after the trader picks 11 days and types the target balance, every expected value is there', () => {
    const fixed = screen([photo], { edits: { tradingDays: 11, profitTargetBalance: 26_250 } });
    // Photo readings are low-confidence: each one asks for a “Looks right” (a confirmation, not a contradiction).
    expect(fixed.model.blockers).toEqual(['Check the total p&l — the reading is uncertain.', 'Check the daily loss limit — the reading is uncertain.']);
    expect(screen([photo], { edits: { tradingDays: 11, profitTargetBalance: 26_250 }, looksRight: ['netPnl', 'dailyLossLimit'] }).model.blockers).toEqual([]);
    expect({
      start: v(fixed, 'startingBalance'),
      balance: v(fixed, 'balance'),
      pnl: v(fixed, 'netPnl'),
      floor: v(fixed, 'drawdownThreshold'),
      remaining: v(fixed, 'drawdownRemaining'),
      dll: v(fixed, 'dailyLossLimit'),
      targetBalance: v(fixed, 'profitTargetBalance'),
      profitRemaining: v(fixed, 'profitRemaining'),
      days: v(fixed, 'tradingDays'),
    }).toEqual({ start: 25_000, balance: 25_390, pnl: 390, floor: 24_402, remaining: 988, dll: 600, targetBalance: 26_250, profitRemaining: 860, days: 11 });
    // Account size and the profit target amount come from the verified LucidFlex 25K rules.
    expect(fixed.model.rows.find((r) => r.key === 'accountSize')?.value).toBe(25_000);
    expect(fixed.model.summary.find((c) => c.key === 'profitTarget')).toMatchObject({ value: 1_250, status: 'verified' });
    expect(fixed.checks.find((c) => c.id === 'balance-remaining-target')?.status).toBe('consistent');
  });
});

/** The review input `screen` used (to re-run buildReview with acks). */
function reviewInput(s: ReturnType<typeof screen>): ReviewInput {
  return {
    mode: 'new',
    fields: s.fields,
    checks: s.checks,
    match: s.match,
    verifiedRules: { profitTarget: 1_250, maxDrawdown: 1_000 },
    locked: new Set(),
    edited: new Set(),
    confirmedFields: new Set(),
    acks: {},
    missingOptions: [],
    name: 'LucidFlex 25K',
    programSize: 25_000,
    programName: 'LucidFlex 25K Evaluation',
    ambiguous: s.ambiguous,
  };
}

describe('the calendar photo (progress bar cropped at the left edge)', () => {
  it('invents nothing: fragments "92" / "88" next to MLL are not a loss limit, the balance readings must be picked', () => {
    const s = screen([calendarPhoto]);
    expect(v(s, 'maxDrawdown')).toBeUndefined();
    expect(v(s, 'drawdownThreshold')).toBeUndefined();
    expect(v(s, 'accountSize')).toBeUndefined();
    // Calendar P&L days ($156.00, −$84.00 …) and day numbers are never account values.
    for (const f of Object.values(s.fields)) if (typeof f?.value === 'number') expect([156, 84, 252, 63, 177].includes(Math.abs(f.value))).toBe(false);
    expect([v(s, 'balance'), ...(s.fields.balance?.alternatives ?? []).map((a) => a.value)].sort()).toEqual([25_300, 25_390]);
    expect(s.model.blockers.join(' ')).toMatch(/Pick the correct current balance/);
  });

  it('together with the account photo, the balance is settled by the account photo’s arithmetic', () => {
    const s = screen([photo, calendarPhoto]);
    expect(v(s, 'balance')).toBe(25_390);
    expect(s.fields.balance?.alternatives).toBeUndefined();
  });
});

describe('updating the saved LucidFlex 25K account from the photo', () => {
  const target = savedLucid();
  const s = screen([photo], { target, edits: { tradingDays: 11, profitTargetBalance: 26_250 }, looksRight: ['netPnl', 'dailyLossLimit'] });

  it('keeps the account’s identity: no size or program change, no reset, no wrong-account conflict', () => {
    expect(s.match.conflicts.filter((c) => c.severity === 'conflict')).toEqual([]);
    expect(s.model.issues.filter((i) => i.kind === 'reset')).toEqual([]);
    expect(s.model.blockers).toEqual([]);
  });

  it('the preview shows the NEW balance from the screenshot next to the saved one; kept values are labelled kept', () => {
    const after = applyImport(target, s.confirmed, 'preview').account;
    const rows = compareUpdate(target, after, providedFigures(Object.keys(s.confirmed.values).filter((k) => s.confirmed.sources[k as FieldKey]?.source !== 'derived')));
    expect(rows.find((r) => r.key === 'balance')).toMatchObject({ before: 25_318, after: 25_390, changed: true, origin: 'update' });
    expect(rows.find((r) => r.key === 'floor')).toMatchObject({ before: 24_330, after: 24_402, origin: 'update' });
    expect(rows.find((r) => r.key === 'remaining')).toMatchObject({ after: 988, origin: 'update' });
    expect(rows.find((r) => r.key === 'dailyLossLimit')).toMatchObject({ after: 600, origin: 'update' });
    // A screenshot that shows only the balance: values it does not provide are labelled kept.
    const cal = screen([calendarPhoto], { target, edits: { balance: 25_390 } });
    const calRows = compareUpdate(target, applyImport(target, cal.confirmed, 'p').account, providedFigures(Object.keys(cal.confirmed.values).filter((k) => cal.confirmed.sources[k as FieldKey]?.source !== 'derived')));
    expect(calRows.find((r) => r.key === 'balance')).toMatchObject({ after: 25_390, origin: 'update' });
    // No threshold on it: the saved floor stays, trailed up by the new balance (a change this update causes).
    expect(calRows.find((r) => r.key === 'floor')).toMatchObject({ before: 24_330, after: 24_390, origin: 'update' });
    expect(calRows.find((r) => r.key === 'dailyLossLimit')).toMatchObject({ before: 600, after: 600, origin: 'kept' });
  });

  it('saves only the confirmed values onto the same record; size, start and verified rules are untouched', () => {
    const r = applyImport(target, s.confirmed, 'imp-1');
    expect(r.account).toMatchObject({ id: 'flex-25k', size: 25_000, startingBalance: 25_000, balance: 25_390 });
    expect(r.account.rules).toMatchObject({ maxDrawdown: 1_000, dailyLossLimit: 600, profitTarget: 1_250 });
    expect(drawdownFloor(r.account)).toBe(24_402);
    expect(drawdownBuffer(r.account)).toBe(988);
    expect(r.account.importState?.reported).toMatchObject({ balance: 25_390, drawdownThreshold: 24_402, netPnl: 390, tradingDays: 11, profitTargetBalance: 26_250 });
  });

  it('repeat import of the same screenshot changes nothing but the history (no duplicate update of values)', () => {
    const once = applyImport(target, s.confirmed, 'imp-1').account;
    const again = screen([photo], { target: once, edits: { tradingDays: 11, profitTargetBalance: 26_250 } });
    const twice = applyImport(once, again.confirmed, 'imp-2').account;
    expect({ balance: twice.balance, hwm: twice.highWaterMark, floor: drawdownFloor(twice), size: twice.size }).toEqual({ balance: once.balance, hwm: once.highWaterMark, floor: drawdownFloor(once), size: once.size });
    expect(compareUpdate(once, twice).filter((r) => r.changed && r.key !== 'asOf')).toEqual([]);
    expect(twice.importState?.history).toHaveLength(2);
  });

  it('values the screenshot does not show stay as saved (never cleared, never zero)', () => {
    const onlyCalendar = screen([calendarPhoto], { target, edits: { balance: 25_390 } });
    const r = applyImport(target, onlyCalendar.confirmed, 'imp-c').account;
    expect(r.balance).toBe(25_390);
    expect(r.importState?.threshold?.value).toBe(24_330);
    expect(r.rules.dailyLossLimit).toBe(600);
  });
});

/** Text lines → an OCR page (each line its own row, words left to right). */
function linesPage(lines: string[]): OcrPage {
  return {
    width: 900,
    height: lines.length * 40,
    confidence: 90,
    lines: lines.map((t, i) => {
      let x = 10;
      const words = t.split(' ').map((w) => {
        const bbox = { x0: x, y0: i * 40, x1: x + w.length * 10, y1: i * 40 + 16 };
        x += w.length * 10 + 10;
        return { text: w, confidence: 90, bbox };
      });
      return { text: t, confidence: 90, bbox: { x0: 10, y0: i * 40, x1: x, y1: i * 40 + 16 }, words };
    }),
  };
}

describe('implausible readings ask for a focused correction', () => {
  it('a $5 minimum balance on a $25,000 account is never a value (and never implies a reset)', () => {
    const target = savedLucid();
    const s = screen([linesPage(['Lucid Trading LucidFlex 25K Evaluation', 'Account Balance $25,390', 'Minimum Balance $5', 'Total P&L +$390'])], { target });
    expect(v(s, 'drawdownThreshold')).toBeUndefined();
    expect(s.ambiguous.find((a) => a.key === 'drawdownThreshold')).toMatchObject({ value: 5 });
    expect(s.ambiguous.find((a) => a.key === 'drawdownThreshold')!.reason).toMatch(/not a plausible minimum balance.*Enter the value/);
    expect(s.match.conflicts.some((c) => c.field === 'drawdownThreshold')).toBe(false);
    // Saved without a threshold: the account keeps its confirmed floor (the EOD trail may only raise it with the balance).
    const saved = applyImport(target, s.confirmed, 'x').account;
    expect(saved.importState?.threshold?.value).toBe(24_330);
    expect(drawdownFloor(saved)).toBe(24_390);
  });

  it('“LUCIDFLEX 36K” on an update keeps the account $25,000 — no size conflict to tick away', () => {
    const target = savedLucid();
    const s = screen([linesPage(['ACTIVE EVAL LUCIDFLEX 36K', 'Account Balance $25,390', 'Total P&L +$390'])], { target });
    expect(v(s, 'accountSize')).toBeUndefined();
    expect(s.ambiguous.find((a) => a.key === 'accountSize')?.value).toBe(36_000);
    expect(s.match.conflicts.some((c) => c.field === 'accountSize')).toBe(false);
    expect(applyImport(target, s.confirmed, 'x').account.size).toBe(25_000);
  });

  it('a new LucidFlex import with a misread size is matched by balance − P&L, never by the misread size', () => {
    const s = screen([linesPage(['Lucid Trading LUCIDFLEX 36K EVAL', 'Account Balance $25,390', 'Total P&L +$390'])]);
    expect(v(s, 'accountSize')).toBeUndefined();
    expect(s.match.program?.programId).toBe('lucid:flex-eval:25k');
  });
});

describe('other screenshots', () => {
  it('a different firm’s account cannot update the Lucid account', () => {
    const s = screen([topstep as unknown as OcrPage], { target: savedLucid() });
    expect(s.match.conflicts.find((c) => c.field === 'firm')?.severity).toBe('conflict');
    expect(s.model.blockers.length).toBeGreaterThan(0);
  });

  it('an unreadable image produces no values and cannot be saved as read', () => {
    const s = screen([blurry as unknown as OcrPage], { target: savedLucid() });
    expect(Object.values(s.fields).filter((f) => f && typeof f.value === 'number')).toEqual([]);
    expect(s.model.blockers.join(' ')).toMatch(/Enter the current balance/);
  });
});
