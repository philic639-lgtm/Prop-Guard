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

describe('V1 audit: remaining risk respects the drawdown floor and the program daily-loss mode', () => {
  it('a small drawdown buffer caps today’s remaining risk below the daily budget', () => {
    // Trailing $1,500 from a $25,500 peak → the trader confirmed the floor $24,000; balance $24,300 → $300 above it.
    const account = makeAccount({ balance: 24300, highWaterMark: 25500, rules: { trailingLocksAtStart: false } as never, importState: { fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value: 24000, source: 'manual', at: '2026-10-02T12:00:00Z' } } });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 400 }), trades: [], now: NOW });
    expect(g.drawdownBuffer).toBe(300);
    expect(g.riskRemaining).toBe(300);
  });

  it('open risk counts against the drawdown room too', () => {
    const account = makeAccount({ balance: 24300, highWaterMark: 25500, rules: { trailingLocksAtStart: false } as never, importState: { fingerprint: null, maskedId: null, reported: null, history: [], threshold: { value: 24000, source: 'manual', at: '2026-10-02T12:00:00Z' } } });
    const open = makeTrade({ status: 'open', pnl: null, exitPrice: null, closedAt: null, riskDollars: 250 });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 400 }), trades: [open], now: NOW });
    expect(g.riskRemaining).toBe(50);
  });

  it('a trailing account above its start with no confirmed threshold: drawdown unknown, never SAFE, no drawdown room assumed', () => {
    const account = makeAccount({ balance: 24300, highWaterMark: 25500 });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 400 }), trades: [], now: NOW });
    expect(g.drawdownUnknown).toBe(true);
    expect(g.drawdownBuffer).toBeNull();
    expect(g.status).not.toBe('SAFE');
    expect(g.reasons.join(' ')).toMatch(/Drawdown floor unknown/);
  });

  it('a verified "no daily loss limit" program uses only the personal daily stop', () => {
    const account = makeAccount({ rules: { dailyLossLimit: null, calc: { dailyLossMode: 'none' } } as never });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 400 }), trades: [], now: NOW });
    expect(g.dailyLimit).toBe(400);
  });

  it('the program’s scaling daily limit is what the guard uses (same as the account evaluation)', () => {
    const account = makeAccount({ highWaterMark: 26000, balance: 26000, rules: { dailyLossLimit: 300, calc: { dailyLossMode: 'scaling', dailyLossScaling: { pct: 2, basis: 'peak_eod_balance', afterBalance: null } } } as never });
    const g = computeDailyGuard({ account, rules: makeRules({ dailyStop: 1000 }), trades: [], now: NOW });
    expect(g.dailyLimit).toBe(520);
  });
});

describe('V1 stabilization: personal daily stop and firm daily limit are named, never blurred', () => {
  it('names the personal stop when it is tighter than the firm limit', () => {
    const g = computeDailyGuard({ account: makeAccount(), rules: makeRules({ dailyStop: 400 }), trades: [], now: NOW });
    expect(g.dailyLimitSource).toBe('personal');
    expect(g.riskRemainingSource).toBe('personal');
    expect(g.personalDailyStop).toBe(400);
    expect(g.firmDailyLimit).toBe(500);
  });

  it('names the firm limit when it is tighter (or equal) and says so when it stops the day', () => {
    const rules = makeRules({ dailyStop: 800 });
    expect(computeDailyGuard({ account: makeAccount(), rules, trades: [], now: NOW }).dailyLimitSource).toBe('firm');
    const t = makeTrade({ pnl: -500, openedAt: minutesAgo(60), closedAt: minutesAgo(50) });
    const g = computeDailyGuard({ account: makeAccount(), rules, trades: [t], now: NOW });
    expect(g.status).toBe('STOP');
    expect(g.reasons).toContain("You've reached the firm's daily loss limit.");
  });

  it('reports the drawdown floor when it leaves less room than the daily budget', () => {
    const account = makeAccount({ balance: 23700 }); // 200 above the 23,500 floor
    const g = computeDailyGuard({ account, rules: makeRules(), trades: [], now: NOW });
    expect(g.riskRemaining).toBe(200);
    expect(g.riskRemainingSource).toBe('drawdown');
  });

  it('with no daily limit at all the source is none', () => {
    const g = computeDailyGuard({ account: makeAccount({ rules: { ...makeAccount().rules, dailyLossLimit: null } }), rules: makeRules({ dailyStop: 0 }), trades: [], now: NOW });
    expect(g.dailyLimitSource).toBe('none');
  });
});
