import { NOW, makeAccount, makeRules, makeTrade } from '@/test/fixtures';

import { computeDailyGuard, consecutiveLosses } from '../dailyGuardEngine';

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('computeDailyGuard', () => {
  it('is SAFE with no trades', () => {
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [], now: NOW });
    expect(g.status).toBe('SAFE');
    expect(g.dailyLimit).toBe(400); // tighter of 500 account / 400 personal
    expect(g.riskRemaining).toBe(400);
    expect(g.tradesRemaining).toBe(3);
  });

  it('matches the mockup: one $150 loss → $150 / $400, 1 / 3, $250 left', () => {
    const t = makeTrade({ pnl: -150, openedAt: minutesAgo(60), closedAt: minutesAgo(50) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [t], now: NOW });
    expect(g.riskUsed).toBe(150);
    expect(g.riskRemaining).toBe(250);
    expect(g.tradesTaken).toBe(1);
    expect(g.cooldown.active).toBe(false);
    expect(g.status).toBe('SAFE');
  });

  it('stays SAFE after a win', () => {
    const t = makeTrade({ pnl: 212.5, openedAt: minutesAgo(60), closedAt: minutesAgo(50) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [t], now: NOW });
    expect(g.status).toBe('SAFE');
    expect(g.riskUsed).toBe(0);
  });

  it('counts open trade risk against the daily budget', () => {
    const t = makeTrade({ status: 'open', pnl: null, closedAt: null, riskDollars: 300, openedAt: minutesAgo(5) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [t], now: NOW });
    expect(g.riskUsed).toBe(300);
    expect(g.status).toBe('CAUTION');
  });

  it('STOPs when daily loss limit reached', () => {
    const t = makeTrade({ pnl: -400, openedAt: minutesAgo(90), closedAt: minutesAgo(80) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [t], now: NOW });
    expect(g.status).toBe('STOP');
    expect(g.riskRemaining).toBe(0);
  });

  it('STOPs when trade limit reached', () => {
    const trades = [1, 2, 3].map((i) => makeTrade({ pnl: 50, openedAt: minutesAgo(100 - i), closedAt: minutesAgo(90 - i) }));
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades, now: NOW });
    expect(g.status).toBe('STOP');
    expect(g.tradesRemaining).toBe(0);
  });

  it('STOPs after max consecutive losses', () => {
    const trades = [
      makeTrade({ pnl: -50, openedAt: minutesAgo(120), closedAt: minutesAgo(110) }),
      makeTrade({ pnl: -50, openedAt: minutesAgo(80), closedAt: minutesAgo(70) }),
    ];
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades, now: NOW });
    expect(g.consecutiveLosses).toBe(2);
    expect(g.status).toBe('STOP');
  });

  it('activates a cooldown after a recent loss', () => {
    const t = makeTrade({ pnl: -100, openedAt: minutesAgo(10), closedAt: minutesAgo(5) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades: [t], now: NOW });
    expect(g.cooldown.active).toBe(true);
    expect(Math.round(g.cooldown.remainingMs / 60_000)).toBe(10);
    expect(g.headline).toBe('Cooldown active');
  });

  it('disables cooldown when anti-revenge is off', () => {
    const t = makeTrade({ pnl: -100, openedAt: minutesAgo(10), closedAt: minutesAgo(5) });
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules({ noRevengeTrades: false }), trades: [t], now: NOW });
    expect(g.cooldown.active).toBe(false);
  });

  it('ignores trades from other days and accounts', () => {
    const trades = [
      makeTrade({ pnl: -400, openedAt: '2026-09-01T14:00:00Z', closedAt: '2026-09-01T14:10:00Z' }),
      makeTrade({ pnl: -400, accountId: 'other', openedAt: minutesAgo(60), closedAt: minutesAgo(50) }),
    ];
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules(), trades, now: NOW });
    expect(g.status).toBe('SAFE');
  });

  it('STOPs when the drawdown floor is breached', () => {
    const account = makeAccount({ balance: 23400, highWaterMark: 25000 });
    const g = computeDailyGuard({ account, rules: makeRules(), trades: [], now: NOW });
    expect(g.drawdownBuffer).toBe(-100);
    expect(g.status).toBe('STOP');
  });

  it('uses personal daily stop when account has no limit', () => {
    const account = makeAccount({ rules: { dailyLossLimit: null } as never });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 300 }), trades: [], now: NOW });
    expect(g.dailyLimit).toBe(300);
  });
});

describe('consecutiveLosses', () => {
  it('counts only the trailing streak', () => {
    const trades = [
      makeTrade({ pnl: -10, closedAt: '2026-10-02T13:00:00Z' }),
      makeTrade({ pnl: 20, closedAt: '2026-10-02T13:10:00Z' }),
      makeTrade({ pnl: -10, closedAt: '2026-10-02T13:20:00Z' }),
      makeTrade({ pnl: -10, closedAt: '2026-10-02T13:30:00Z' }),
    ];
    expect(consecutiveLosses(trades)).toBe(2);
  });
});
