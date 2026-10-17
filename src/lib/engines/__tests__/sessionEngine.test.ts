import { makeRules, makeTrade } from '@/test/fixtures';

import { localSessionReview, summarizeSession } from '../sessionEngine';

describe('session summary', () => {
  it('detects a trade taken inside the cooldown', () => {
    const trades = [
      makeTrade({ pnl: -150, realizedR: -1, openedAt: '2026-10-02T13:50:00Z', closedAt: '2026-10-02T13:55:00Z' }),
      makeTrade({ pnl: 475, realizedR: 3.6, openedAt: '2026-10-02T14:01:00Z', closedAt: '2026-10-02T14:20:00Z' }),
    ];
    const rules = makeRules();
    const s = summarizeSession(trades, [], rules);
    expect(s.netPnl).toBe(325);
    expect(s.winRate).toBe(0.5);
    expect(s.cooldownGaps).toEqual([6]);
    const review = localSessionReview(s, rules);
    expect(review.focusTomorrow).toBe('Respect the cooldown rule.');
    expect(review.improvements[0]).toMatch(/6 minutes after a loss/);
  });

  it('treats a no-trade session as disciplined', () => {
    const rules = makeRules();
    const review = localSessionReview(summarizeSession([], [], rules), rules);
    expect(review.summary).toMatch(/valid, disciplined outcome/);
  });
});
