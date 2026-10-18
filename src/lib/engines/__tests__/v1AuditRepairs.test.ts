/**
 * FEATURE_AUDIT.md repairs: drawdown methods (static / EOD / intraday trailing), missing-data
 * protection in the pre-trade check, per-account daily-loss attention, and the personalized
 * news + cushion alert.
 */
import { NOW, makeAccount, makeRules, makeStrategy } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import { accountCard } from '../accountOverview';
import { applyImport, confirmImport } from '../accountImport';
import { computeDailyGuard } from '../dailyGuardEngine';
import type { NewsRisk } from '../economicCalendar';
import { newsCushionAlert } from '../newsCushion';
import { drawdownBuffer, drawdownFloor, floorStatus } from '../propRuleEngine';
import { calculateTradeRisk } from '../riskEngine';
import { resolveFloor, type FloorInputs } from '../setupCheck/drawdown';
import { evaluateSetup, type SetupEvaluationInput } from '../strategyEngine';

const AT = '2026-10-13T15:00:00Z';
const base: FloorInputs = { method: 'static', methodKnown: true, startingBalance: 50_000, balance: 50_000, highWaterMark: 50_000, maxDrawdown: 2_000, lockOffset: null, confirmed: null };

describe('drawdown floor by method', () => {
  it('static: start − allowance, whatever the peak', () => {
    const r = resolveFloor({ ...base, balance: 52_500, highWaterMark: 53_000 });
    expect(r).toMatchObject({ floor: 48_000, basis: 'static_rule' });
    expect(r.minimum).toBeUndefined();
  });

  it('EOD trailing: a confirmed threshold rises with later closed gains and is exact', () => {
    const r = resolveFloor({ ...base, method: 'eod_trailing', balance: 51_500, highWaterMark: 51_500, confirmed: { value: 48_800, source: 'screenshot', at: AT } });
    expect(r).toMatchObject({ floor: 49_500, basis: 'confirmed_trailed' });
    expect(r.minimum).toBeUndefined();
  });

  it('EOD and intraday trailing above the start without a confirmed threshold: unknown, never estimated', () => {
    for (const method of ['eod_trailing', 'trailing'] as const) {
      const r = resolveFloor({ ...base, method, balance: 51_000, highWaterMark: 51_200 });
      expect(r.floor).toBeNull();
      expect(r.needs).toEqual(['threshold']);
    }
  });

  it('intraday trailing: a confirmed floor is only a minimum (open-profit peaks are not visible)', () => {
    const r = resolveFloor({ ...base, method: 'trailing', balance: 50_600, highWaterMark: 50_600, confirmed: { value: 48_500, source: 'manual', at: AT } });
    expect(r.floor).toBe(48_600);
    expect(r.minimum).toBe(true);
    expect(r.reason).toMatch(/treat it as a minimum/);
  });

  it('intraday trailing already at its lock is exact again', () => {
    const r = resolveFloor({ ...base, method: 'trailing', lockOffset: 100, balance: 53_000, highWaterMark: 53_000, confirmed: { value: 50_100, source: 'screenshot', at: AT } });
    expect(r.floor).toBe(50_100);
    expect(r.minimum).toBeUndefined();
  });

  it('an unconfirmed drawdown type is never used to calculate', () => {
    expect(resolveFloor({ ...base, methodKnown: false }).floor).toBeNull();
  });
});

const intraday = (over: Partial<Account> = {}): Account =>
  makeAccount({
    balance: 25_400,
    highWaterMark: 25_400,
    rules: { ...makeAccount().rules, drawdownType: 'trailing', maxDrawdown: 1_500 },
    importState: { fingerprint: null, maskedId: null, history: [], threshold: { value: 23_900, source: 'manual', at: AT } } as never,
    ...over,
  });

describe('Daily Guard with an intraday trailing floor', () => {
  it('is never SAFE: the buffer shown is an upper bound', () => {
    const a = intraday();
    expect(floorStatus(a).minimum).toBe(true);
    expect(drawdownFloor(a)).toBe(23_900);
    expect(drawdownBuffer(a)).toBe(1_500);
    const g = computeDailyGuard({ account: a, rules: makeRules(), trades: [], now: NOW });
    expect(g.drawdownMinimum).toBe(true);
    expect(g.status).toBe('CAUTION');
    expect(g.reasons.join(' ')).toMatch(/Intraday trailing/);
  });
});

function setup(overrides: Partial<SetupEvaluationInput> = {}, rules = makeRules(), account = makeAccount()): SetupEvaluationInput {
  return {
    strategy: makeStrategy(),
    direction: 'long',
    bias: 'bullish',
    answers: { orb: true, breakout: true, retest: true },
    risk: calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6042.25, stop: 6037.25, target: 6052.25, contracts: 5 }),
    contracts: 5,
    rules,
    guard: computeDailyGuard({ account, rules, trades: [], now: NOW }),
    recentStopPoints: [5, 5, 5],
    strategyTradesToday: 0,
    now: NOW,
    ...overrides,
  };
}

describe('pre-trade check refuses when required data is missing', () => {
  const red = ['RULE_VIOLATION', 'NO_TRADE'];

  it('baseline with every limit set is green', () => {
    expect(evaluateSetup(setup()).grade).toBe('A_PLUS');
  });

  it('no max risk per trade → red, never "within a $0 limit"', () => {
    const r = evaluateSetup(setup({}, makeRules({ maxRiskPerTrade: 0 })));
    expect(red).toContain(r.grade);
    expect(r.violations.join(' ')).toMatch(/No max risk per trade/);
    expect(r.violations.join(' ')).not.toMatch(/\$0 per-trade/);
  });

  it('no daily limit at all (no personal stop, no firm DLL) → red', () => {
    const rules = makeRules({ dailyStop: 0 });
    const account = makeAccount({ rules: { ...makeAccount().rules, dailyLossLimit: null } });
    const r = evaluateSetup(setup({}, rules, account));
    expect(red).toContain(r.grade);
    expect(r.violations.join(' ')).toMatch(/No daily loss limit/);
  });

  it('unknown drawdown floor → red', () => {
    const account = makeAccount({ balance: 25_600, highWaterMark: 25_800 });
    const r = evaluateSetup(setup({}, makeRules(), account));
    expect(red).toContain(r.grade);
    expect(r.checks.find((c) => c.id === 'account_drawdown')?.passed).toBe(false);
  });

  it('no stop (invalid risk) → never green', () => {
    const risk = calculateTradeRisk({ instrument: 'MES', direction: 'long', entry: 6042.25, stop: null as never, target: 6052.25, contracts: 5 });
    expect(['A_PLUS', 'VALID']).not.toContain(evaluateSetup(setup({ risk })).grade);
  });
});

describe('My Accounts attention includes daily loss per account', () => {
  const ctx = { trades: [], rules: makeRules(), now: NOW, primaryId: null, activeId: null };

  it('a firm DLL nearly used is flagged even when the drawdown is healthy', () => {
    const a = makeAccount({ id: 'a' });
    const trades = [{ id: 't', accountId: 'a', status: 'closed', pnl: -420, openedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), closedAt: new Date(NOW.getTime() - 3_000_000).toISOString() }] as never;
    const card = accountCard(a, { ...ctx, trades });
    expect(card.attention.map((x) => x.text).join(' ')).toMatch(/daily loss limit nearly used/);
  });

  it('balances are per card, never combined', () => {
    const a = accountCard(makeAccount({ id: 'a', balance: 25_100 }), ctx);
    const b = accountCard(makeAccount({ id: 'b', balance: 50_200 }), ctx);
    expect([a.balance, b.balance]).toEqual([25_100, 50_200]);
  });
});

const risk = (over: Partial<NewsRisk> = {}): NewsRisk => ({
  state: 'approaching',
  event: null,
  impact: 'high',
  windowStart: null,
  windowEnd: null,
  minutesToRelease: 20,
  headline: 'CPI at 8:30 AM ET',
  guidance: [],
  ...over,
});

describe('personalized news + cushion alert', () => {
  it('nothing when the calendar is clear', () => {
    expect(newsCushionAlert(risk({ state: 'clear' }), null, 250)).toBeNull();
  });

  it('names the limit the cushion comes from', () => {
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [], now: NOW });
    const a = newsCushionAlert(risk({ impact: 'medium' }), g, 250, 'Eval 25K')!;
    expect(a.cushionLine).toBe('Eval 25K: $400 left before your daily stop.');
    expect(a.level).toBe('info');
  });

  it('high-impact release with less than one full-risk trade left → danger', () => {
    const g = { ...computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [], now: NOW }), riskRemaining: 180 };
    const a = newsCushionAlert(risk(), g, 250)!;
    expect(a.level).toBe('danger');
    expect(a.notes[0]).toMatch(/Less than one full-risk trade/);
  });

  it('unknown floor is never presented as room', () => {
    const g = computeDailyGuard({ account: makeAccount({ balance: 25_600, highWaterMark: 25_800 }), rules: makeRules(), trades: [], now: NOW });
    const a = newsCushionAlert(risk(), g, 250)!;
    expect(a.cushion).toBeNull();
    expect(a.cushionLine).toMatch(/needs verification/);
    expect(a.level).toBe('danger');
  });

  it('no account selected → warning, no number', () => {
    expect(newsCushionAlert(risk(), null, 250)).toMatchObject({ level: 'warning', cushion: null });
  });
});

describe('screenshot confirmation applies only what the trader confirmed', () => {
  it('a value left out of the confirmation does not change the account', () => {
    const a = makeAccount({ importState: { fingerprint: null, maskedId: null, history: [], threshold: { value: 23_600, source: 'manual', at: AT } } as never });
    const c = confirmImport({
      fields: { balance: { key: 'balance', value: 25_300, confidence: 0.95, source: 'ocr', evidence: 'Balance $25,300', page: 0 } },
      edited: new Set(),
      fingerprint: null,
      maskedId: null,
      engine: 'ocr',
      pages: 1,
      now: NOW,
    });
    const r = applyImport(a, c, 'imp');
    expect(r.account.balance).toBe(25_300);
    expect(r.account.importState?.threshold?.value).toBe(23_600);
    expect(r.account.rules).toEqual(a.rules);
  });
});
