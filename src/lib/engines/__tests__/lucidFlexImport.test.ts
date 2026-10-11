/**
 * Regression: LucidFlex 25K evaluation imported from real dashboard screenshots.
 *
 * The bug: the $24,934 balance was imported, but the account kept a $23,500
 * floor (25,000 − a $1,500 form default), $1,434 "remaining", a $500 daily
 * loss limit and a $1,500 target — although the screenshots show MLL
 * $24,270, DLL $600 and target $1,250.
 *
 * Fixtures are REAL tesseract.js output (the app's own OCR, same
 * preprocessing) for synthetic Lucid-style dashboards carrying exactly those
 * figures: an overview (ACCOUNT BALANCE / MLL + "MINIMUM BALANCE" caption /
 * DAILY LOSS LIMIT / PROFIT TARGET / TRADING DAYS / TOTAL P&L, EOD TRAILING),
 * an account-rules page (Max Loss Limit $1,000 as an amount, the profit
 * target as a $26,250 balance), a later snapshot and an older one.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { accountToForm, formToAccount, ruleValuesOf, type AccountFormValues } from '@/features/accounts/accountSchema';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';
import { makeAccount, makeRules } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import {
  applyImport,
  confirmImport,
  extractPage,
  matchImport,
  reconcile,
  type ConfirmedImport,
  type Extraction,
  type FieldKey,
  type ImportMatch,
  type OcrPage,
} from '../accountImport';
import { computeDailyGuard } from '../dailyGuardEngine';
import { calcAfterOverrides, detectOverrides, getProgram, importProgramRules, linkFor } from '../firmRulesEngine';
import { drawdownBuffer, drawdownFloor, evaluateAccount } from '../propRuleEngine';

import later from './fixtures/accountScreenshots/lucidflex-later.json';
import older from './fixtures/accountScreenshots/lucidflex-older.json';
import overview from './fixtures/accountScreenshots/lucidflex-overview.json';
import rulesPage from './fixtures/accountScreenshots/lucidflex-rules.json';
import topstep from './fixtures/accountScreenshots/topstep.json';

const db = FIRM_RULES_SEED;
const firms = db.firms;
const TODAY = '2026-10-10';
const AT = new Date('2026-10-10T20:05:00Z');
const run = (...pages: unknown[]): Extraction => reconcile(pages.map((p, i) => extractPage(p as OcrPage, i, { firms })));
const v = (x: Extraction, k: FieldKey) => x.fields[k]?.value;
const match = (x: Extraction, target: Account | null = null): ImportMatch =>
  matchImport(x, { db, accounts: target ? [target] : [], target, today: TODAY, mode: target ? 'update' : 'new' });
const confirmFrom = (x: Extraction, opts: { ruleUpdates?: ConfirmedImport['ruleUpdates']; reset?: boolean; now?: Date } = {}) =>
  confirmImport({ fields: x.fields, edited: new Set(), ruleUpdates: opts.ruleUpdates ?? {}, reset: opts.reset, fingerprint: x.fingerprint, maskedId: null, engine: 'ocr', pages: x.pages.length, now: opts.now ?? AT });

/**
 * The new-account path exactly as the app runs it: matched program loaded
 * into the form (verified rules), screenshot rule values the verified program
 * does not state (LucidFlex's optional DLL), save → formToAccount → confirmed
 * import applied (useConsumeImport.finish).
 */
function saveNewAccount(x: Extraction): Account {
  const m = match(x);
  const prog = getProgram(db, m.program!.programId)!;
  const imp = importProgramRules(prog, m.ruleDate, m.options);
  const form: AccountFormValues = { ...accountToForm(null), name: prog.name, firm: 'Lucid Trading', kind: 'prop', size: String(prog.accountSize), balance: String(v(x, 'balance')) };
  if (imp.status === 'verified') Object.assign(form, imp.values);
  // Screenshot rule values the verified program leaves to the account (the review screen's ruleUpdates).
  const ruleUpdates: ConfirmedImport['ruleUpdates'] = {};
  for (const c of m.ruleComparisons) if (c.verified == null && c.screenshot != null) ruleUpdates[c.field] = c.screenshot;
  for (const [k, val] of Object.entries(ruleUpdates)) (form as Record<string, string>)[k] = String(val);
  const link = linkFor(db.firms.find((f) => f.id === 'lucid')!, prog, imp, AT.toISOString(), m.options);
  const firmLink = { ...link, overrides: detectOverrides(link.imported, ruleValuesOf(form)) };
  const account = formToAccount(form, null, 'acc-lucidflex', undefined, firmLink);
  const calc = calcAfterOverrides(firmLink.calc, firmLink.overrides, form.dailyLossLimit);
  if (calc) account.rules.calc = calc;
  return applyImport(account, { ...confirmFrom(x, { ruleUpdates }), ruleUpdates: {} }, 'imp1').account;
}

describe('LucidFlex 25K — extraction from real OCR', () => {
  it('overview screenshot: every visible value, MLL read as the current minimum balance (not the loss allowance)', () => {
    const x = run(overview);
    expect(v(x, 'firm')).toBe('Lucid Trading');
    expect(String(v(x, 'program'))).toMatch(/LucidFlex 25K/);
    expect(v(x, 'stage')).toBe('evaluation');
    expect(v(x, 'accountSize')).toBe(25_000);
    expect(v(x, 'balance')).toBe(24_934);
    expect(v(x, 'drawdownThreshold')).toBe(24_270);
    expect(v(x, 'drawdownRemaining')).toBe(664);
    expect(x.fields.drawdownRemaining!.source).toBe('derived'); // balance − floor, never typed in
    expect(v(x, 'maxDrawdown')).toBeUndefined(); // "MLL $24,270" is a level, not a $24,270 allowance
    expect(v(x, 'dailyLossLimit')).toBe(600);
    expect(v(x, 'profitTarget')).toBe(1_250);
    expect(v(x, 'profitTargetBalance')).toBe(26_250);
    expect(v(x, 'netPnl')).toBe(-66);
    expect(v(x, 'tradingDays')).toBe(5);
    expect(v(x, 'drawdownType')).toBe('eod_trailing');
    expect(x.checks.filter((c) => c.status === 'conflict')).toEqual([]);
  });

  it('overview + rules page combine: allowance $1,000 and the $26,250 target balance land in their own fields', () => {
    const x = run(overview, rulesPage);
    expect(v(x, 'maxDrawdown')).toBe(1_000);
    expect(v(x, 'drawdownThreshold')).toBe(24_270);
    expect(v(x, 'drawdownRemaining')).toBe(664);
    expect(v(x, 'startingBalance')).toBe(25_000);
    expect(v(x, 'profitTarget')).toBe(1_250);
    expect(v(x, 'profitTargetBalance')).toBe(26_250);
    expect(x.fields.profitTargetBalance!.source).toBe('ocr'); // read on the rules page, not calculated
    expect(v(x, 'dailyLossLimit')).toBe(600);
    expect(v(x, 'drawdownType')).toBe('eod_trailing');
    // Evidence per page is kept.
    expect(x.fields.maxDrawdown!.page).toBe(1);
    expect(x.fields.balance!.page).toBe(0);
    expect(x.checks.filter((c) => c.status === 'conflict')).toEqual([]);
  });

  it('identifies LucidFlex 25K Evaluation (not LucidPro, not generic Lucid), DLL option on, rules compared', () => {
    const m = match(run(overview, rulesPage));
    expect(m.program?.programId).toBe('lucid:flex-eval:25k');
    expect(m.options).toEqual({ dll: 'on' });
    expect(m.rulesStatus).toBe('verified');
    const cmp = Object.fromEntries(m.ruleComparisons.map((c) => [c.field, c]));
    expect(cmp.maxDrawdown).toMatchObject({ verified: 1_000, screenshot: 1_000, status: 'match' });
    expect(cmp.profitTarget).toMatchObject({ verified: 1_250, screenshot: 1_250, status: 'match' });
    // LucidFlex's DLL amount is an account setting the verified rules do not state.
    expect(cmp.dailyLossLimit).toMatchObject({ verified: null, screenshot: 600, status: 'screenshot_only' });
    expect(m.conflicts.filter((c) => c.severity === 'conflict')).toEqual([]);
  });
});

describe('LucidFlex 25K — saved account and dashboard numbers', () => {
  it('the exact fixture: balance 24,934 · floor 24,270 · remaining 664 · allowance 1,000 · DLL 600 · target 1,250 / 26,250', () => {
    const a = saveNewAccount(run(overview, rulesPage));
    expect(a.balance).toBe(24_934);
    expect(a.size).toBe(25_000);
    expect(a.rules.maxDrawdown).toBe(1_000);
    expect(a.rules.dailyLossLimit).toBe(600);
    expect(a.rules.profitTarget).toBe(1_250);
    expect(a.startingBalance + a.rules.profitTarget!).toBe(26_250);
    expect(a.rules.drawdownType).toBe('eod_trailing');
    expect(drawdownFloor(a)).toBe(24_270);
    expect(drawdownBuffer(a)).toBe(664);
    expect(a.importState?.reported).toMatchObject({ balance: 24_934, drawdownThreshold: 24_270, drawdownRemaining: 664, netPnl: -66, tradingDays: 5, drawdownType: 'eod_trailing', profitTarget: 1_250, profitTargetBalance: 26_250 });
    expect(a.firmLink?.programId).toBe('lucid:flex-eval:25k');
    // Verified rules untouched; the DLL is the account's own value (the program states none), so it is not locked.
    expect(a.firmLink?.overrides).toEqual([]);
    expect(a.firmLink?.imported.dailyLossLimit ?? '').toBe('');
  });

  it('the rules engine and risk numbers agree: profit progress uses the saved target, drawdown the exact floor', () => {
    const a = saveNewAccount(run(overview, rulesPage));
    const e = evaluateAccount(a, [], AT);
    expect(e.targetProgress).toBe(0); // −$66 so far
    const dd = e.rules.find((r) => r.id === 'max_drawdown');
    expect(dd).toMatchObject({ label: 'EOD trailing drawdown', current: '$664 buffer', limit: 'Floor $24,270', status: 'ok' });
  });

  it('a new account form never starts with invented firm limits', () => {
    const f = accountToForm(null);
    expect([f.profitTarget, f.maxDrawdown, f.dailyLossLimit, f.size, f.balance]).toEqual(['', '', '', '', '']);
  });

  it('an account left with the old wrong defaults is repaired by the screenshot (update path)', () => {
    // What the bug produced: 25K, $1,500 drawdown → $23,500 floor, $500 DLL, $1,500 target.
    const wrong = makeAccount({ id: 'w', size: 25_000, startingBalance: 25_000, cycleStartBalance: 25_000, balance: 24_934, highWaterMark: 25_000, rules: { maxDrawdown: 1_500, dailyLossLimit: 500, profitTarget: 1_500, drawdownType: 'eod_trailing' } as never });
    expect(drawdownFloor(wrong)).toBe(23_500);
    expect(drawdownBuffer(wrong)).toBe(1_434);
    const x = run(overview, rulesPage);
    const r = applyImport(wrong, confirmFrom(x, { ruleUpdates: { maxDrawdown: 1_000, dailyLossLimit: 600, profitTarget: 1_250 } }), 'fix');
    expect(drawdownFloor(r.account)).toBe(24_270);
    expect(drawdownBuffer(r.account)).toBe(664);
    expect(r.account.rules).toMatchObject({ maxDrawdown: 1_000, dailyLossLimit: 600, profitTarget: 1_250 });
    // Even WITHOUT correcting the allowance, the shown MLL wins over 25,000 − 1,500.
    const kept = applyImport(wrong, confirmFrom(x), 'fix2').account;
    expect(drawdownFloor(kept)).toBe(24_270);
    expect(drawdownBuffer(kept)).toBe(664);
  });

  it('missing MLL: the floor comes from the rules (and says so) — never a guessed level; no allowance → unknown', () => {
    const noMll = JSON.parse(JSON.stringify(overview).split('$24,270.00').join('').split('MLL').join('').split('MINIMUM BALANCE').join(''));
    const x = run(noMll);
    expect(v(x, 'drawdownThreshold')).toBeUndefined();
    expect(v(x, 'drawdownRemaining')).toBeUndefined();
    const withRules = makeAccount({ size: 25_000, startingBalance: 25_000, balance: 25_000, highWaterMark: 25_000, rules: { maxDrawdown: 1_000, drawdownType: 'eod_trailing', trailingLocksAtStart: false, calc: { trailingLockOffset: 100 } } as never });
    const a = applyImport(withRules, confirmFrom(x), 'i').account;
    expect(drawdownFloor(a)).toBe(24_000); // 25,000 peak − 1,000 allowance (nothing observed)
    expect(a.importState?.reported?.missing).toContain('drawdownThreshold');
    const noRules = makeAccount({ size: 25_000, startingBalance: 25_000, balance: 25_000, highWaterMark: 25_000, rules: { maxDrawdown: null, drawdownType: 'eod_trailing' } as never });
    expect(drawdownFloor(applyImport(noRules, confirmFrom(x), 'i').account)).toBeNull();
  });
});

describe('multiple / repeated screenshots', () => {
  it('conflicting screenshots (older balance) are flagged for review, never silently merged', () => {
    const x = run(overview, older);
    const seen = (k: FieldKey) => [x.fields[k]!.value, ...(x.fields[k]!.alternatives ?? []).map((a) => a.value)];
    expect(seen('balance')).toEqual(expect.arrayContaining([24_934, 24_500]));
    expect(seen('tradingDays')).toEqual(expect.arrayContaining([5, 4]));
    expect(x.checks.filter((c) => c.status === 'conflict').map((c) => c.id)).toEqual(expect.arrayContaining(['conflict:balance', 'conflict:tradingDays']));
  });

  it('the same screenshot twice agrees (no conflict) and re-applying it is idempotent', () => {
    const x = run(overview, overview);
    expect(x.checks.filter((c) => c.status === 'conflict')).toEqual([]);
    const once = saveNewAccount(run(overview, rulesPage));
    const twice = applyImport(once, confirmFrom(run(overview)), 'again').account;
    expect([twice.balance, drawdownFloor(twice), drawdownBuffer(twice)]).toEqual([24_934, 24_270, 664]);
    expect(twice.importState?.history).toHaveLength(2);
  });

  it('EOD trailing: a later snapshot moves the floor UP; an older/lower one never moves it down without a reset', () => {
    const a = saveNewAccount(run(overview, rulesPage));
    const up = applyImport(a, confirmFrom(run(later), { now: new Date('2026-10-13T20:10:00Z') }), 'later').account;
    expect([up.balance, drawdownFloor(up), drawdownBuffer(up)]).toEqual([25_410, 24_410, 1_000]);
    // A lower floor afterwards: flagged as a conflict, and not applied unless the trader confirms a reset.
    const back = run(older);
    expect(match(back, up).conflicts.find((c) => c.field === 'drawdownThreshold')?.severity).toBe('conflict');
    const notReset = applyImport(up, confirmFrom(back), 'older').account;
    expect(drawdownFloor(notReset)).toBe(24_410);
    expect(notReset.importState?.history[0].notes.join(' ')).toMatch(/does not move down/);
    const reset = applyImport(up, confirmFrom(back, { reset: true }), 'reset').account;
    expect(drawdownFloor(reset)).toBe(24_270);
    expect(reset.importState?.reported?.reset).toBe(true);
  });
});

describe('persistence and dashboard status', () => {
  it('saved values survive the database round trip (save → reload)', () => {
    const a = saveNewAccount(run(overview, rulesPage));
    const rows = accountToRows(a, 'user-1');
    const back = rowsToAccount(rows.account as never, rows.rules as never);
    expect([back.balance, back.rules.maxDrawdown, back.rules.dailyLossLimit, back.rules.profitTarget]).toEqual([24_934, 1_000, 600, 1_250]);
    expect([drawdownFloor(back), drawdownBuffer(back)]).toEqual([24_270, 664]);
    expect(back.importState?.reported).toMatchObject({ tradingDays: 5, netPnl: -66, drawdownType: 'eod_trailing' });
  });

  it('a screenshot-only account is never "safe to trade" on its personal budget; P&L today is unknown, limits are separate', () => {
    const a = saveNewAccount(run(overview, rulesPage));
    const g = computeDailyGuard({ account: a, rules: makeRules(), trades: [], now: new Date('2026-10-10T21:00:00Z') });
    expect(g.status).not.toBe('SAFE');
    expect(g.headline).toBe('Snapshot-based — not live verified');
    expect(g.snapshot).toMatchObject({ stale: false });
    expect(g.dailyPnlSource).toBe('unknown');
    expect(g.drawdownBuffer).toBe(664);
    expect(g.firmDailyLimit).toBe(600); // the firm's rule
    expect(g.personalDailyStop).toBe(400); // the trader's own plan — never shown as the firm's
    // Next day: the snapshot is stale and says so.
    const tomorrow = computeDailyGuard({ account: a, rules: makeRules(), trades: [], now: new Date('2026-10-11T15:00:00Z') });
    expect(tomorrow.snapshot?.stale).toBe(true);
    expect(tomorrow.reasons[0]).toMatch(/earlier day/);
  });

  it('accounts without a screenshot keep the normal Daily Guard', () => {
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [], now: AT });
    expect(g.status).toBe('SAFE');
    expect(g.snapshot).toBeNull();
    expect(g.dailyPnlSource).toBe('journal');
  });
});

describe('other firms and programs (regression)', () => {
  it('Topstep: "Maximum Loss Limit 2,000" stays the allowance; a balance-sized MLL is a level', () => {
    const x = run(topstep);
    expect(v(x, 'maxDrawdown')).toBe(2_000);
    // Its floor is calculated from balance − "Distance to MLL", not read.
    expect(x.fields.drawdownThreshold).toMatchObject({ value: 49_000, source: 'derived' });
    expect(match(x).program?.programId).toBeDefined();
  });

  it('"Lucid Flex" written apart is still LucidFlex; LucidPro is not confused with it', () => {
    const spaced = JSON.parse(JSON.stringify(overview).split('LucidFlex').join('Lucid Flex'));
    expect(match(run(spaced, rulesPage)).program?.programId).toBe('lucid:flex-eval:25k');
    const pro = JSON.parse(JSON.stringify(overview).split('LucidFlex').join('LucidPro'));
    expect(match(run(pro)).program?.programId).toBe('lucid:pro-eval:25k');
  });
});
