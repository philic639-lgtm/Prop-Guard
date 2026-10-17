import { makeRules, makeTrade } from '@/test/fixtures';

import { performanceByConditions, tradeConditions } from '../analyticsEngine';
import { sessionFlags, summarizeSession } from '../sessionEngine';

const full = ['risk_per_trade', 'risk_daily', 'min_rr', 'target_set', 'check_a', 'check_b', 'check_c'];

describe('performanceByConditions', () => {
  const trades = [
    makeTrade({ pnl: 250, realizedR: 2, rulesFollowed: full }),
    makeTrade({ pnl: 250, realizedR: 2, rulesFollowed: [...full, 'entry_window'] }),
    makeTrade({ pnl: -125, realizedR: -1, rulesFollowed: full.slice(0, 6), rulesViolated: ['check_c'] }),
    makeTrade({ pnl: -125, realizedR: -1, rulesFollowed: full.slice(0, 5), rulesViolated: ['check_b', 'check_c'] }),
  ];

  it('ignores the context-only entry window when counting conditions', () => {
    expect(tradeConditions(trades[1])).toEqual({ met: 7, total: 7 });
  });

  it('buckets by conditions missed with typical-total labels', () => {
    const b = performanceByConditions(trades);
    expect(b.map((x) => x.label)).toEqual(['7/7', '6/7', '5/7 or less']);
    expect(b[0].count).toBe(2);
    expect(b[0].totalR).toBe(4);
    expect(b[0].winRate).toBe(1);
    expect(b[2].netPnl).toBe(-125);
  });
});

describe('sessionFlags', () => {
  it('flags revenge trading, overtrading and risk breaches', () => {
    const rules = makeRules({ maxTradesPerDay: 1, maxRiskPerTrade: 150 });
    const trades = [
      makeTrade({ pnl: -150, riskDollars: 150, openedAt: '2026-10-02T13:50:00Z', closedAt: '2026-10-02T13:55:00Z' }),
      makeTrade({ pnl: 100, riskDollars: 300, openedAt: '2026-10-02T14:00:00Z', closedAt: '2026-10-02T14:20:00Z' }),
    ];
    const f = sessionFlags(summarizeSession(trades, [], rules), trades, rules);
    expect(f.revengeTrading).toBe(true);
    expect(f.overtrading).toBe(true);
    expect(f.riskBreaches).toBe(1);
    expect(f.riskDiscipline).toBe(50);
  });

  it('is clean for a disciplined session', () => {
    const rules = makeRules();
    const trades = [makeTrade({ pnl: 250, riskDollars: 125 })];
    const f = sessionFlags(summarizeSession(trades, [], rules), trades, rules);
    expect(f).toMatchObject({ revengeTrading: false, overtrading: false, riskBreaches: 0, riskDiscipline: 100 });
  });
});
