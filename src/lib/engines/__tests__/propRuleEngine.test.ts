import { NOW, makeAccount, makeTrade } from '@/test/fixtures';

import { drawdownBuffer, drawdownFloor, evaluateAccount } from '../propRuleEngine';

describe('drawdown', () => {
  it('static drawdown floor never moves', () => {
    const a = makeAccount({ highWaterMark: 26000, balance: 25500, rules: { drawdownType: 'static' } as never });
    expect(drawdownFloor(a)).toBe(23500);
    expect(drawdownBuffer(a)).toBe(2000);
  });

  it('trailing drawdown follows the high-water mark', () => {
    const a = makeAccount({ highWaterMark: 25800, balance: 25500, rules: { trailingLocksAtStart: false } as never });
    expect(drawdownFloor(a)).toBe(24300);
    expect(drawdownBuffer(a)).toBe(1200);
  });

  it('trailing drawdown locks at starting balance when configured', () => {
    const a = makeAccount({ highWaterMark: 27000, balance: 26800, rules: { trailingLocksAtStart: true } as never });
    expect(drawdownFloor(a)).toBe(25000);
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
