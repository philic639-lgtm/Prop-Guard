import { computeDailyGuard, computeDisciplineScore, computeStats } from '@/lib/engines';

import { createDemoData } from '../demo';

describe('demo data', () => {
  const now = new Date('2026-10-02T15:30:00Z');
  const data = createDemoData(now);
  const account = data.accounts[0];
  const trades = data.trades.filter((t) => t.accountId === account.id);

  it('produces a plausible prop account', () => {
    const net = account.balance - account.startingBalance;
    expect(net).toBeGreaterThan(300);
    expect(net).toBeLessThan(3000);
    expect(trades.length).toBeGreaterThan(15);
  });

  it('shows the mockup Daily Guard state for today', () => {
    const g = computeDailyGuard({ account, rules: data.tradingRules, trades: data.trades, now });
    expect(g.status).toBe('SAFE');
    expect(g.riskUsed).toBe(150);
    expect(g.dailyLimit).toBe(400);
    expect(g.tradesTaken).toBe(1);
  });

  it('has realistic stats and a strong-but-imperfect discipline score', () => {
    const s = computeStats(trades);
    expect(s.winRate).toBeGreaterThan(0.35);
    expect(s.winRate).toBeLessThan(0.75);
    const d = computeDisciplineScore(trades, data.events);
    expect(d.score).toBeGreaterThanOrEqual(75);
    expect(d.score).toBeLessThan(100);
  });

  it('uses valid UUIDs for Supabase compatibility', () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const t of data.trades) expect(t.id).toMatch(re);
    for (const s of data.sessions) expect(s.id).toMatch(re);
    for (const e of data.events) expect(e.id).toMatch(re);
  });
});
