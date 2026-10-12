import { accountToForm, formToAccount } from '@/features/accounts/accountSchema';
import { NOW, makeAccount, makeTrade } from '@/test/fixtures';

import { drawdownBuffer, drawdownFloor, evaluateAccount, floorStatus, ruleFloor } from '../propRuleEngine';

describe('drawdown', () => {
  it('static drawdown floor never moves', () => {
    const a = makeAccount({ highWaterMark: 26000, balance: 25500, rules: { drawdownType: 'static' } as never });
    expect(drawdownFloor(a)).toBe(23500);
    expect(drawdownBuffer(a)).toBe(2000);
  });

  // A trailing threshold depends on the peak balance, which Prop Guard cannot see: it is never
  // assumed from the high-water mark — it needs a confirmed threshold (screenshot / entered).
  const confirmed = (value: number, source: 'manual' | 'screenshot' = 'manual') => ({ fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value, source, at: '2026-10-01T12:00:00Z' } });

  it('trailing drawdown above the start without a confirmed threshold: needs verification, no buffer', () => {
    const a = makeAccount({ highWaterMark: 25800, balance: 25500, rules: { trailingLocksAtStart: false } as never });
    expect(drawdownFloor(a)).toBeNull();
    expect(drawdownBuffer(a)).toBeNull();
    expect(floorStatus(a)).toMatchObject({ needs: ['threshold'], reason: expect.stringMatching(/Needs verification/) });
    expect(ruleFloor(a)).toBe(24300); // the rule math itself is unchanged (used only to cross-check)
  });

  it('a trailing account never above its start: threshold = start − allowance', () => {
    const a = makeAccount({ highWaterMark: 25000, balance: 24600 });
    expect(floorStatus(a)).toMatchObject({ floor: 23500, basis: 'untouched_trailing' });
  });

  it('trailing drawdown follows the high-water mark from a confirmed threshold (never below it)', () => {
    const a = makeAccount({ highWaterMark: 25800, balance: 25500, rules: { trailingLocksAtStart: false } as never, importState: confirmed(24300) });
    expect(drawdownFloor(a)).toBe(24300);
    expect(drawdownBuffer(a)).toBe(1200);
    // A later journaled peak raises it…
    expect(floorStatus({ ...a, highWaterMark: 26200, balance: 26000 })).toMatchObject({ floor: 24700, basis: 'confirmed_trailed' });
    // …a lower rule trail never lowers it.
    expect(drawdownFloor({ ...a, highWaterMark: 25000 })).toBe(24300);
  });

  it('trailing drawdown locks at starting balance when configured', () => {
    const a = makeAccount({ highWaterMark: 27000, balance: 26800, rules: { trailingLocksAtStart: true } as never, importState: confirmed(24800) });
    expect(drawdownFloor(a)).toBe(25000);
  });

  it('an entered threshold is used as entered and keeps its manual source', () => {
    const a = makeAccount({ highWaterMark: 25800, balance: 25500, importState: confirmed(24400) });
    expect(floorStatus(a)).toMatchObject({ floor: 24400, basis: 'confirmed', reason: expect.stringMatching(/entered by you/) });
    expect(drawdownBuffer(a)).toBe(1100);
  });

  it('a defaulted (unconfirmed) drawdown type is never used to calculate a threshold', () => {
    const a = makeAccount({ rules: { drawdownType: 'static' } as never, importState: { fingerprint: null, maskedId: null, reported: null, history: [], unconfirmed: ['drawdownType'] } });
    expect(floorStatus(a)).toMatchObject({ floor: null, needs: ['threshold', 'drawdown_method'] });
  });

  it('returns null when no max drawdown configured', () => {
    expect(drawdownFloor(makeAccount({ rules: { maxDrawdown: null } as never }))).toBeNull();
  });
});

describe('evaluateAccount', () => {
  it('flags daily loss proximity', () => {
    const t = makeTrade({ pnl: -400 });
    const ev = evaluateAccount(makeAccount(), [t], NOW);
    const daily = ev.rules.find((r) => r.id === 'daily_loss')!;
    expect(daily.status).toBe('warning');
    expect(daily.proximity).toBeCloseTo(0.8);
  });

  it('flags a daily loss breach', () => {
    const ev = evaluateAccount(makeAccount(), [makeTrade({ pnl: -500 })], NOW);
    expect(ev.rules.find((r) => r.id === 'daily_loss')!.status).toBe('breached');
    expect(ev.breached).toBe(true);
  });

  it('tracks profit target progress', () => {
    const a = makeAccount({ balance: 25750, rules: { profitTarget: 1500 } as never });
    const ev = evaluateAccount(a, [], NOW);
    expect(ev.profitToTarget).toBe(750);
    expect(ev.targetProgress).toBe(0.5);
  });

  it('evaluates the consistency rule', () => {
    const trades = [
      makeTrade({ pnl: 800, closedAt: '2026-09-28T14:00:00Z' }),
      makeTrade({ pnl: 100, closedAt: '2026-09-29T14:00:00Z' }),
      makeTrade({ pnl: 100, closedAt: '2026-09-30T14:00:00Z' }),
    ];
    const a = makeAccount({ rules: { consistencyPct: 40 } as never });
    const rule = evaluateAccount(a, trades, NOW).rules.find((r) => r.id === 'consistency')!;
    expect(rule.status).toBe('warning');
    expect(rule.current).toBe('80% best day');
  });

  it('counts trading days and min-days rule', () => {
    const trades = [
      makeTrade({ pnl: 10, closedAt: '2026-09-28T14:00:00Z' }),
      makeTrade({ pnl: 10, closedAt: '2026-09-28T15:00:00Z' }),
      makeTrade({ pnl: 10, closedAt: '2026-09-29T14:00:00Z' }),
    ];
    const ev = evaluateAccount(makeAccount({ rules: { minTradingDays: 5 } as never }), trades, NOW);
    expect(ev.tradingDays).toBe(2);
    expect(ev.rules.find((r) => r.id === 'min_days')!.message).toMatch(/3 more/);
  });

  it('includes custom rules as manual items', () => {
    const a = makeAccount({ rules: { custom: [{ id: 'news', label: 'No trading during FOMC' }] } as never });
    const ev = evaluateAccount(a, [], NOW);
    expect(ev.rules.some((r) => r.label === 'No trading during FOMC')).toBe(true);
  });

  it('flags max contract breaches', () => {
    const ev = evaluateAccount(makeAccount(), [makeTrade({ pnl: 10, contracts: 15 })], NOW);
    expect(ev.rules.find((r) => r.id === 'max_contracts')!.status).toBe('breached');
  });
});

describe('drawdown remaining import', () => {
  it('reproduces an entered drawdown buffer (stored as a manually confirmed threshold)', () => {
    const form = { ...accountToForm(null), size: '25000', balance: '26420', maxDrawdown: '1500', drawdownType: 'eod_trailing' as const };
    const a = formToAccount(form, null, 'x', 1300);
    expect(drawdownBuffer(a)).toBe(1300);
    expect(a.importState?.threshold).toMatchObject({ value: 25120, source: 'manual' });
  });

  it('a new trailing account above its start without a threshold is not given a guessed floor', () => {
    const form = { ...accountToForm(null), size: '25000', balance: '26420', maxDrawdown: '1500', drawdownType: 'eod_trailing' as const };
    expect(drawdownFloor(formToAccount(form, null, 'x'))).toBeNull();
  });
});
