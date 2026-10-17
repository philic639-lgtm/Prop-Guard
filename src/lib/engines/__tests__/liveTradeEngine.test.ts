import { makeTrade } from '@/test/fixtures';

import { closedTradeAlert, liveAlerts, liveState } from '../liveTradeEngine';

// ES long 6742 / stop 6737 / target 6752, 1 contract
const trade = makeTrade({ instrument: 'ES', contracts: 1, entryPrice: 6742, stopPrice: 6737, originalStopPrice: 6737, targetPrice: 6752, status: 'open', pnl: null, closedAt: null });

describe('liveState', () => {
  it('computes open P/L, R and target progress', () => {
    const s = liveState(trade, 6747);
    expect(s.pnl).toBe(250);
    expect(s.r).toBe(1);
    expect(s.targetProgress).toBe(0.5);
    expect(s.pointsToStop).toBe(10);
  });

  it('detects target and stop hits for shorts', () => {
    const short = { ...trade, direction: 'short' as const, stopPrice: 6747, originalStopPrice: 6747, targetPrice: 6732 };
    expect(liveState(short, 6731).targetHit).toBe(true);
    expect(liveState(short, 6748).stopHit).toBe(true);
  });
});

describe('liveAlerts', () => {
  it('confirms a good entry, then suggests breakeven at +1R', () => {
    expect(liveAlerts(trade, 6744).map((a) => a.kind)).toEqual(['good_entry']);
    const at1R = liveAlerts(trade, 6747, new Set(['good_entry']));
    expect(at1R.map((a) => a.kind)).toEqual(['move_stop_breakeven']);
    expect(at1R[0].body).toMatch(/\+5 pts in profit/);
  });

  it('does not suggest breakeven once the stop is already at entry', () => {
    expect(liveAlerts({ ...trade, stopPrice: 6742 }, 6747, new Set(['good_entry']))).toEqual([]);
  });

  it('warns when price approaches the stop', () => {
    const a = liveAlerts(trade, 6738);
    expect(a[0].kind).toBe('approaching_stop');
    expect(a[0].body).toMatch(/-4 pts from entry \(1 pt to stop\)/);
  });

  it('reports take profit and suppresses duplicates', () => {
    expect(liveAlerts(trade, 6752)[0].kind).toBe('take_profit');
    expect(liveAlerts(trade, 6752, new Set(['take_profit']))).toEqual([]);
  });

  it('formats the closed-trade alert', () => {
    expect(closedTradeAlert({ ...trade, pnl: 500, points: 10 }).body).toBe('ES Long | +10 pts | +$500');
  });
});
