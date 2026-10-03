import { makeStrategy, makeTrade } from '@/test/fixtures';

import { bestStrategy, computeStats, equityCurve, performanceByCompliance, pnlByStrategy } from '../analyticsEngine';

const trades = [
  makeTrade({ pnl: 500, realizedR: 2, closedAt: '2026-10-01T14:00:00Z' }),
  makeTrade({ pnl: -250, realizedR: -1, closedAt: '2026-10-01T15:00:00Z' }),
  makeTrade({ pnl: 250, realizedR: 1, closedAt: '2026-10-02T14:00:00Z', strategyId: 'vwap' }),
  makeTrade({ status: 'open', pnl: null }),
];

describe('computeStats', () => {
  it('computes core metrics from closed trades only', () => {
    const s = computeStats(trades);
    expect(s.count).toBe(3);
    expect(s.netPnl).toBe(500);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.profitFactor).toBe(3);
    expect(s.avgR).toBe(0.67);
    expect(s.avgWin).toBe(375);
    expect(s.avgLoss).toBe(-250);
    expect(s.largestLoss).toBe(-250);
  });

  it('handles empty input', () => {
    const s = computeStats([]);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.netPnl).toBe(0);
  });

  it('reports infinite profit factor with no losses', () => {
    expect(computeStats([makeTrade({ pnl: 100 })]).profitFactor).toBe(Infinity);
  });
});

describe('equity and grouping', () => {
  it('builds an equity curve in close order', () => {
    const curve = equityCurve(trades, 25000);
    expect(curve.map((p) => p.y)).toEqual([25000, 25500, 25250, 25500]);
  });

  it('groups by strategy and finds the best', () => {
    const strategies = [makeStrategy(), makeStrategy({ id: 'vwap', name: 'VWAP Reclaim' })];
    const groups = pnlByStrategy(trades, strategies);
    expect(groups[0].label).toBe('15M ORB');
    expect(bestStrategy(trades, strategies)!.pnl).toBe(250);
  });

  it('splits performance by compliance', () => {
    const t = [makeTrade({ pnl: 100 }), makeTrade({ pnl: -300, rulesViolated: ['cooldown'] })];
    const r = performanceByCompliance(t, []);
    expect(r.followed.netPnl).toBe(100);
    expect(r.violated.netPnl).toBe(-300);
  });
});
