/**
 * Account onboarding accuracy: screenshot → review → saved account → edits → dashboard.
 *
 * Fixtures are SYNTHETIC: OCR output of mock-up dashboards (./fixtures/accountScreenshots)
 * and hand-built accounts. Passing tests do not prove accuracy on screenshots that were
 * not tested.
 */
import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { createAccountFromImport } from '@/features/accountImport/createAccount';
import { accountToRows, rowsToAccount } from '@/services/supabase/mappers';
import { makeAccount, makeRules, makeStrategy, makeTrade } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import {
  accountDetails,
  accountFreshness,
  applyDetailEdits,
  detailChanges,
  detailValues,
  manualConflicts,
  missingCritical,
  parseAmount,
  validateDetails,
  withJournalBalance,
  type DetailValues,
} from '../accountDetails';
import { applyImport, confirmImport, crossCheck, extractPage, matchImport, mergePages, type FieldKey, type FieldMap, type OcrPage } from '../accountImport';
import { calculateTradeRisk } from '../riskEngine';
import { evaluateSetup as evaluateTradeSetup } from '../strategyEngine';
import { computeDailyGuard } from '../dailyGuardEngine';
import { getProgram, validateFirmConfiguration } from '../firmRulesEngine';
import { drawdownBuffer, drawdownFloor, floorStatus } from '../propRuleEngine';
import { accountRiskState } from '@/services/setupCheck/localContext';
import { propBuffers } from '../setupCheck';

import nll from './fixtures/accountScreenshots/lucidflex-nll.json';
import overview from './fixtures/accountScreenshots/lucidflex-overview.json';

const db = FIRM_RULES_SEED;
const TODAY = '2026-10-11';
const NOW = new Date('2026-10-11T14:00:00Z');

/** Read synthetic screenshots the way the import screen does. */
function read(pages: unknown[]) {
  const exts = pages.map((p, i) => extractPage(p as OcrPage, i, { firms: db.firms }));
  const fields: FieldMap = crossCheck(mergePages(exts)).fields;
  const match = matchImport({ fields, sensitive: [], pages: [], checks: [], fingerprint: null }, { db, accounts: [], target: null, today: TODAY, mode: 'new', programId: 'lucid:flex-eval:25k' });
  return { fields, match };
}
function createFrom(pages: unknown[], edits: Partial<Record<FieldKey, number>> = {}): Account {
  const { fields, match } = read(pages);
  for (const [k, v] of Object.entries(edits)) fields[k as FieldKey] = { key: k as FieldKey, value: v, confidence: 1, source: 'user', evidence: 'Entered', page: -1 };
  const c = confirmImport({ fields, edited: new Set(Object.keys(edits) as FieldKey[]), fingerprint: null, maskedId: null, engine: 'ocr', pages: pages.length, now: NOW });
  const r = createAccountFromImport({ db, id: 'acc-x', name: 'Lucid 25K', firmName: 'Lucid Trading', programId: 'lucid:flex-eval:25k', options: { dll: 'on' }, ruleDate: match.ruleDate, confirmed: c, now: NOW });
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join(' '));
  return r.result.account;
}
const valuesOf = (a: Account, personal: number | null = 400) => detailValues(a, personal);

describe('1. screenshot extraction → saved account with sources', () => {
  it('the threshold shown on the dashboard is saved as read, with screenshot provenance', () => {
    const a = createFrom([nll], { balance: 24_934 });
    expect(drawdownFloor(a)).toBe(24_270);
    expect(drawdownBuffer(a)).toBe(664);
    const v = accountDetails(a, 400);
    expect(v.fields.drawdownThreshold).toMatchObject({ value: 24_270, origin: 'screenshot' });
    expect(v.fields.balance.origin).toBe('manual'); // typed during the review
    expect(v.fields.maxDrawdown.origin).toBe('verified_program');
    expect(v.drawdownRemaining).toMatchObject({ value: 664, origin: 'calculated' });
  });
});

describe('2. missing threshold handling', () => {
  it('a trailing account imported without a threshold shows "Needs verification" — never start − allowance once above the start', () => {
    const { fields } = read([overview]);
    delete fields.drawdownThreshold;
    delete fields.drawdownRemaining;
    fields.balance = { key: 'balance', value: 25_400, confidence: 1, source: 'user', evidence: 'Entered', page: -1 };
    const c = confirmImport({ fields, edited: new Set(['balance']), fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = createAccountFromImport({ db, id: 'acc-y', name: 'Lucid 25K', firmName: 'Lucid Trading', programId: 'lucid:flex-eval:25k', options: { dll: 'on' }, ruleDate: TODAY, confirmed: c, now: NOW });
    const a = (r as { ok: true; result: { account: Account } }).result.account;
    expect(drawdownFloor(a)).toBeNull();
    expect(floorStatus(a).reason).toMatch(/Needs verification/);
    expect(accountDetails(a, 400).drawdownRemaining).toMatchObject({ value: null, origin: 'missing' });
    expect(missingCritical(a).map((m) => m.key)).toEqual(['drawdownThreshold']);
  });

  it('no verified program and no drawdown type on the screenshot: the type is "needs confirmation", never assumed', () => {
    const fields: FieldMap = {
      balance: { key: 'balance', value: 50_200, confidence: 0.95, source: 'ocr', evidence: 'Balance', page: 0 },
      accountSize: { key: 'accountSize', value: 50_000, confidence: 0.95, source: 'ocr', evidence: 'Account size', page: 0 },
      maxDrawdown: { key: 'maxDrawdown', value: 2_000, confidence: 0.95, source: 'ocr', evidence: 'Max loss', page: 0 },
    };
    const c = confirmImport({ fields, edited: new Set(), ruleUpdates: { maxDrawdown: 2_000 }, fingerprint: null, maskedId: null, engine: 'ocr', pages: 1, now: NOW });
    const r = createAccountFromImport({ db, id: 'acc-z', name: 'Some firm 50K', firmName: 'Unknown Firm', programId: null, options: {}, ruleDate: TODAY, confirmed: c, now: NOW });
    const a = (r as { ok: true; result: { account: Account } }).result.account;
    expect(a.importState?.unconfirmed).toContain('drawdownType');
    expect(accountDetails(a, null).fields.drawdownType.origin).toBe('missing');
    expect(drawdownFloor(a)).toBeNull(); // not computed from a defaulted type
  });
});

describe('3. manual corrections', () => {
  it('editing one value saves only that value as "manual" and recalculates the dependent numbers', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const before = valuesOf(a);
    const after: DetailValues = { ...before, balance: 25_100 };
    expect(detailChanges(before, after)).toEqual([{ key: 'balance', label: 'Current balance', before: '$24,934', after: '$25,100' }]);
    const r = applyDetailEdits(a, before, after, NOW);
    expect(r.account.balance).toBe(25_100);
    expect(r.account.importState?.origins?.balance).toMatchObject({ source: 'manual' });
    expect(drawdownBuffer(r.account)).toBe(830); // 25,100 − 24,270
    expect(r.account.importState?.history[0]).toMatchObject({ engine: 'manual' });
    // Everything else untouched.
    expect(r.account.rules).toEqual(a.rules);
    expect(drawdownFloor(r.account)).toBe(24_270);
  });

  it('an entered threshold keeps its manual label and the cushion uses it', () => {
    const a = makeAccount({ balance: 25_600, highWaterMark: 25_900 });
    expect(drawdownFloor(a)).toBeNull();
    const before = valuesOf(a);
    const r = applyDetailEdits(a, before, { ...before, drawdownThreshold: 24_400 }, NOW);
    expect(accountDetails(r.account, 400).fields.drawdownThreshold).toMatchObject({ value: 24_400, origin: 'manual' });
    expect(drawdownBuffer(r.account)).toBe(1_200);
    // An older, higher peak can never silently override the number the trader entered.
    expect(drawdownFloor({ ...r.account, highWaterMark: Math.max(r.account.highWaterMark, 25_900) })).toBe(24_400);
  });

  it('changing a verified rule records an override of the firm rule', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const before = valuesOf(a);
    expect(accountDetails(a, 400).fields.maxDrawdown.origin).toBe('verified_program');
    const r = applyDetailEdits(a, before, { ...before, maxDrawdown: 900 }, NOW);
    expect(r.account.rules.maxDrawdown).toBe(900);
    expect(r.account.firmLink?.overrides).toContain('maxDrawdown');
    expect(r.account.rules.calc?.trailingLockOffset).toBeUndefined(); // typed calculations of an overridden rule are dropped
    expect(accountDetails(r.account, 400).fields.maxDrawdown.origin).toBe('manual');
    // LucidFlex's daily loss limit is an account setting the program leaves open — editing it is not an override.
    expect(applyDetailEdits(a, before, { ...before, dailyLossLimit: 400 }, NOW).account.firmLink?.overrides).not.toContain('dailyLossLimit');
  });

  it('cancel = not applying: the saved account is unchanged', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const snapshot = JSON.stringify(a);
    const before = valuesOf(a);
    detailChanges(before, { ...before, balance: 1 }); // a preview never mutates
    applyDetailEdits(a, before, { ...before, balance: 1 }, NOW); // pure — returns a new account
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('4. persistence after refresh (Supabase row round-trip)', () => {
  it('manual threshold, origins, unconfirmed and edit time survive save → load', () => {
    const a = makeAccount({ balance: 25_600, highWaterMark: 25_900 });
    const before = valuesOf(a);
    const edited = applyDetailEdits(a, before, { ...before, drawdownThreshold: 24_400, profitTarget: 1_500 }, NOW).account;
    const rows = accountToRows(edited, 'u1');
    const back = rowsToAccount(JSON.parse(JSON.stringify(rows.account)), JSON.parse(JSON.stringify(rows.rules)));
    expect(back.importState?.threshold).toEqual({ value: 24_400, source: 'manual', at: NOW.toISOString() });
    expect(back.importState?.origins?.profitTarget?.source).toBe('manual');
    expect(back.importState?.editedAt).toBe(NOW.toISOString());
    expect(drawdownBuffer(back)).toBe(1_200);
  });
});

describe('5. multiple screenshot imports', () => {
  it('overview + NLL page merge into one account with one threshold', () => {
    const a = createFrom([overview, nll]);
    expect(drawdownFloor(a)).toBe(24_270);
    expect(a.importState?.history).toHaveLength(1);
    expect(a.importState?.reported?.balance).toBe(a.balance);
  });
});

describe('6. no accidental overwrites', () => {
  it('a manual correction is listed as a conflict, and kept when the trader chooses to keep it', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const before = valuesOf(a);
    const corrected = applyDetailEdits(a, before, { ...before, drawdownThreshold: 24_300 }, NOW).account;
    // A later screenshot shows a different threshold and balance.
    const conflicts = manualConflicts(corrected, { drawdownThreshold: 24_270, balance: 25_000 });
    expect(conflicts.map((c) => c.key).sort()).toEqual(['balance', 'drawdownThreshold']);
    const c = confirmImport({
      fields: { balance: { key: 'balance', value: 25_000, confidence: 0.95, source: 'ocr', evidence: '', page: 0 }, drawdownThreshold: { key: 'drawdownThreshold', value: 24_270, confidence: 0.95, source: 'ocr', evidence: '', page: 0 } },
      edited: new Set(),
      fingerprint: null,
      maskedId: null,
      engine: 'ocr',
      pages: 1,
      now: new Date('2026-10-12T14:00:00Z'),
      keepManual: ['drawdownThreshold'],
    });
    const r = applyImport(corrected, c, 'u2');
    expect(drawdownFloor(r.account)).toBe(24_300); // kept
    expect(r.account.importState?.threshold?.source).toBe('manual');
    expect(r.account.balance).toBe(25_000); // the trader did not keep the balance correction
    expect(r.account.importState?.origins?.balance?.source).toBe('screenshot');
    expect(r.record.notes.join(' ')).toMatch(/manual correction was kept/);
  });

  it('values equal to the correction are not conflicts', () => {
    const a = makeAccount({ importState: { fingerprint: null, maskedId: null, reported: null, history: [], origins: { balance: { source: 'manual', at: TODAY } } } });
    expect(manualConflicts(a, { balance: a.balance })).toEqual([]);
  });
});

describe('7. static drawdown', () => {
  it('threshold = starting balance − allowance, labelled calculated, and it never moves with the balance', () => {
    const a = makeAccount({ balance: 26_000, highWaterMark: 26_400, rules: { drawdownType: 'static', maxDrawdown: 2_000 } as never });
    expect(floorStatus(a)).toMatchObject({ floor: 23_000, basis: 'static_rule' });
    expect(accountDetails(a, null).fields.drawdownThreshold.origin).toBe('calculated');
    expect(drawdownFloor({ ...a, highWaterMark: 30_000, balance: 29_000 })).toBe(23_000);
  });
});

describe('8. trailing drawdown (EOD and intraday)', () => {
  it.each(['eod_trailing', 'trailing'] as const)('%s: unknown above the start without a threshold; follows a confirmed one up, never down', (type) => {
    const a = makeAccount({ balance: 25_500, highWaterMark: 25_800, rules: { drawdownType: type, maxDrawdown: 1_500, trailingLocksAtStart: false } as never });
    expect(drawdownFloor(a)).toBeNull();
    expect(floorStatus(a).reason).toMatch(type === 'eod_trailing' ? /end-of-day/ : /intraday/);
    const t = { ...a, importState: { fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value: 24_300, source: 'screenshot' as const, at: TODAY } } };
    expect(drawdownFloor(t)).toBe(24_300);
    expect(drawdownFloor({ ...t, highWaterMark: 26_000 })).toBe(24_500);
    expect(drawdownFloor({ ...t, highWaterMark: 25_000 })).toBe(24_300);
  });

  it('Setup Check uses the same floor as the dashboard (server-shared policy)', () => {
    const a = makeAccount({ balance: 25_500, highWaterMark: 25_800, importState: { fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value: 24_300, source: 'manual', at: TODAY } } });
    expect(propBuffers(accountRiskState(a, [], NOW), false).drawdownBuffer).toBe(drawdownBuffer(a));
    const unknown = makeAccount({ balance: 25_500, highWaterMark: 25_800 });
    expect(propBuffers(accountRiskState(unknown, [], NOW), false).drawdownBuffer).toBeUndefined();
  });
});

describe('9. incorrect program selection', () => {
  it('a program whose size does not match the account is refused before saving', () => {
    const program = getProgram(db, 'lucid:flex-eval:25k')!;
    const a = createFrom([nll], { balance: 24_934 });
    const issues = validateFirmConfiguration(db, a.firmLink!, { size: '50000' }, NOW.toISOString());
    expect(issues.length).toBeGreaterThan(0);
    expect(program.accountSize).toBe(25_000);
  });
});

describe('10. stale account data', () => {
  it('a screenshot is as old as its dashboard date — an old dashboard imported today is stale', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const old = { ...a, importState: { ...a.importState!, reported: { ...a.importState!.reported!, asOf: '2026-10-08' } } };
    expect(accountFreshness(old, NOW)).toMatchObject({ source: 'screenshot', stale: true, asOf: '2026-10-08' });
    const g = computeDailyGuard({ account: old, rules: makeRules(), trades: [], now: NOW });
    expect(g.snapshot?.stale).toBe(true);
    expect(g.status).not.toBe('SAFE');
  });

  it('a manual update today makes the data current again; stale and missing are reported separately', () => {
    const a = createFrom([nll], { balance: 24_934 });
    const old = { ...a, importState: { ...a.importState!, reported: { ...a.importState!.reported!, at: '2026-10-08T14:00:00Z' } } };
    expect(accountFreshness(old, NOW).stale).toBe(true);
    const before = valuesOf(old);
    const edited = applyDetailEdits(old, before, { ...before, balance: 25_010 }, NOW).account;
    expect(accountFreshness(edited, NOW)).toMatchObject({ stale: false, source: 'manual' });
    expect(computeDailyGuard({ account: edited, rules: makeRules(), trades: [], now: NOW }).snapshot?.stale).toBe(false);
    expect(missingCritical(edited)).toEqual([]); // stale ≠ missing
  });
});

describe('10b. freshness wording follows the data source', () => {
  it('a journal update counts as an update; an old screenshot asks for a new one; a journal-tracked balance gets a milder note', () => {
    const created = makeAccount({ createdAt: '2026-09-01T00:00:00Z' });
    expect(accountFreshness(created, NOW)).toMatchObject({ source: 'created', stale: true, staleMessage: expect.stringMatching(/last confirmed/) });
    const journaled = withJournalBalance({ ...created, importState: { fingerprint: null, maskedId: null, reported: null, history: [] } }, 25_100, NOW.toISOString());
    expect(accountFreshness(journaled, NOW)).toMatchObject({ source: 'journal', stale: false, staleMessage: null });
    const shot = createFrom([nll], { balance: 24_934 });
    const old = { ...shot, importState: { ...shot.importState!, reported: { ...shot.importState!.reported!, asOf: '2026-10-08' } } };
    expect(accountFreshness(old, NOW).staleMessage).toMatch(/screenshot shows 2026-10-08/);
  });
});

describe('11. negative and invalid numbers', () => {
  const base = valuesOf(makeAccount());
  it.each([
    ['balance', -100, /more than zero/],
    ['balance', Number.NaN, /Enter a number/],
    ['drawdownThreshold', 0, /more than zero/],
    ['profitTarget', -66, /more than zero/],
    ['maxDrawdown', 30_000, /smaller than the account size/],
    ['drawdownThreshold', 26_000, /below the current balance/],
  ] as const)('%s = %p is rejected', (key, value, msg) => {
    expect(validateDetails({ ...base, [key]: value }, 'prop').errors[key]).toMatch(msg);
  });
  it('parses "$1,500.50", rejects text, keeps empty as empty', () => {
    expect(parseAmount('$1,500.50')).toBe(1500.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('1.2.3')).toBeNaN();
  });
  it('a balance-sized profit target and a cushion larger than the allowance are flagged before saving', () => {
    const w = validateDetails({ ...base, profitTarget: 26_500, drawdownThreshold: 22_000, maxDrawdown: 1_500 }, 'prop').warnings.join(' ');
    expect(w).toMatch(/looks like a balance level/);
    expect(w).toMatch(/larger than the maximum drawdown/);
  });
});

describe('12. dashboard numbers follow saved values', () => {
  it('editing balance and threshold updates remaining drawdown, target progress and the Daily Guard immediately', () => {
    const a = makeAccount({ balance: 25_600, highWaterMark: 25_900, rules: { profitTarget: 1_500 } as never });
    const before = valuesOf(a);
    const edited = applyDetailEdits(a, before, { ...before, balance: 25_750, drawdownThreshold: 24_500 }, NOW).account;
    const v = accountDetails(edited, 400);
    expect(v.drawdownRemaining.value).toBe(1_250);
    expect(v.targetProgress).toBeCloseTo(0.5);
    const g = computeDailyGuard({ account: edited, rules: makeRules({ dailyStop: 400 }), trades: [], now: NOW });
    expect(g.drawdownBuffer).toBe(1_250);
    expect(g.drawdownUnknown).toBe(false);
  });

  it('a journaled trade updates the balance and marks it calculated', () => {
    const a = makeAccount({ importState: { fingerprint: null, maskedId: null, reported: null, history: [], origins: { balance: { source: 'manual', at: TODAY } } } });
    const b = withJournalBalance(a, 25_150, NOW.toISOString());
    expect(b.balance).toBe(25_150);
    expect(accountDetails(b, null).fields.balance.origin).toBe('calculated');
  });
});

describe('13. risk manager safety', () => {
  it('no risk recommendation while the threshold is missing: Check Trade fails a rule, the guard is never SAFE', () => {
    const account = makeAccount({ balance: 25_600, highWaterMark: 25_900 });
    const guard = computeDailyGuard({ account, rules: makeRules(), trades: [], now: NOW });
    expect(guard.drawdownUnknown).toBe(true);
    expect(guard.status).not.toBe('SAFE');
    const ev = evaluateTradeSetup({
      strategy: makeStrategy(),
      rules: makeRules(),
      guard,
      direction: 'long',
      bias: null,
      answers: {},
      risk: calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6000, stop: 5995, target: 6010, contracts: 1 }),
      contracts: 1,
      recentStopPoints: [],
      strategyTradesToday: 0,
      now: NOW,
    });
    expect(ev.rulesViolated).toContain('account_drawdown');
    expect(ev.violations.join(' ')).toMatch(/liquidation threshold needs verification/);
  });

  it('with a confirmed threshold the same trade gets no drawdown violation', () => {
    const account = makeAccount({ balance: 25_600, highWaterMark: 25_900, importState: { fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value: 24_400, source: 'manual', at: TODAY } } });
    const guard = computeDailyGuard({ account, rules: makeRules(), trades: [makeTrade({ pnl: 0 })], now: NOW });
    expect(guard.drawdownUnknown).toBe(false);
    expect(guard.drawdownBuffer).toBe(1_200);
  });
});
