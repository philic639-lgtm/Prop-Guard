import type { DisciplineEvent } from '@/types/domain';
import { makeTrade } from '@/test/fixtures';

import { computeDisciplineScore, disciplineLabel, disciplineTimeline, tradeDisciplineScore } from '../disciplineEngine';

const ev = (o: Partial<DisciplineEvent>): DisciplineEvent => ({
  id: Math.random().toString(36),
  type: 'RULE_OVERRIDDEN',
  category: 'risk',
  accountId: 'acc1',
  tradeId: null,
  sessionId: null,
  detail: '',
  at: '2026-10-02T14:00:00Z',
  ...o,
});

describe('computeDisciplineScore', () => {
  it('returns a neutral 100 with no trades', () => {
    const s = computeDisciplineScore([], []);
    expect(s.score).toBe(100);
    expect(s.hasData).toBe(false);
  });

  it('scores perfect adherence at 100', () => {
    const trades = [makeTrade({ journaled: true, pnl: -50 }), makeTrade({ journaled: true, pnl: 100 })];
    expect(computeDisciplineScore(trades, []).score).toBe(100);
  });

  it('does not reward profit — a losing disciplined day equals a winning one', () => {
    const losing = [makeTrade({ journaled: true, pnl: -250 })];
    const winning = [makeTrade({ journaled: true, pnl: 1000 })];
    expect(computeDisciplineScore(losing, []).score).toBe(computeDisciplineScore(winning, []).score);
  });

  it('penalizes violations by component', () => {
    const t1 = makeTrade({ journaled: true });
    const t2 = makeTrade({ journaled: true });
    const s = computeDisciplineScore([t1, t2], [ev({ type: 'COOLDOWN_BROKEN', category: 'cooldown', tradeId: t2.id })]);
    expect(s.components.find((c) => c.key === 'cooldown')!.score).toBe(50);
    expect(s.score).toBe(95);
  });

  it('counts multiple violations on one trade once per component', () => {
    const t = makeTrade({ journaled: true });
    const events = [ev({ tradeId: t.id }), ev({ tradeId: t.id })];
    expect(computeDisciplineScore([t], events).components.find((c) => c.key === 'risk')!.violations).toBe(1);
  });

  it('ignores informational events', () => {
    const t = makeTrade({ journaled: true });
    expect(computeDisciplineScore([t], [ev({ type: 'DAILY_LIMIT_HIT', tradeId: t.id })]).score).toBe(100);
  });

  it('reflects journal completion', () => {
    const trades = [makeTrade({ journaled: true }), makeTrade({ journaled: false })];
    expect(computeDisciplineScore(trades, []).components.find((c) => c.key === 'journal')!.score).toBe(50);
  });

  it('measures strategy consistency', () => {
    const trades = [makeTrade({ journaled: true, strategyId: 'a' }), makeTrade({ journaled: true, strategyId: 'a' }), makeTrade({ journaled: true, strategyId: 'b' }), makeTrade({ journaled: true, strategyId: 'a' })];
    expect(computeDisciplineScore(trades, []).components.find((c) => c.key === 'consistency')!.score).toBe(75);
  });

  it('never goes below 0 or above 100', () => {
    const t = makeTrade();
    const events = (['risk', 'entry', 'trade_limit', 'stop', 'cooldown'] as const).map((category) => ev({ category, tradeId: t.id }));
    const s = computeDisciplineScore([t], events);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});

describe('labels and per-trade score', () => {
  it('labels thresholds', () => {
    expect(disciplineLabel(87).label).toBe('Strong discipline');
    expect(disciplineLabel(92).label).toBe('Elite discipline');
    expect(disciplineLabel(40).tone).toBe('danger');
  });

  it('per-trade score drops 25 per violation', () => {
    const events = [ev({ tradeId: 'x' }), ev({ tradeId: 'x', type: 'STOP_WIDENED' })];
    expect(tradeDisciplineScore('x', events)).toBe(50);
    expect(tradeDisciplineScore('y', events)).toBe(100);
  });

  it('builds a chronological timeline', () => {
    const trades = [
      makeTrade({ journaled: true, openedAt: '2026-10-01T14:00:00Z' }),
      makeTrade({ journaled: true, openedAt: '2026-09-30T14:00:00Z' }),
    ];
    const tl = disciplineTimeline(trades, []);
    expect(tl.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-01']);
  });
});
