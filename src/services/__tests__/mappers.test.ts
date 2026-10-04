import { createDemoData } from '@/data/demo';

import { accountToRows, pendingToRow, practiceAttemptToRow, practiceLessonToRow, rowToPracticeAttempt, rowToPracticeLesson, rowToPending, rowsToAccount, rowsToStrategy, rowsToTrade, strategyToRows, tradeToRows } from '../supabase/mappers';

const data = createDemoData(new Date('2026-10-02T15:30:00Z'));

describe('supabase mappers', () => {
  it('round-trips accounts with prop rules', () => {
    const a = data.accounts[0];
    const { account, rules } = accountToRows(a, 'user');
    const back = rowsToAccount({ ...account, created_at: a.createdAt }, rules);
    expect(back).toEqual(a);
  });

  it('round-trips strategies with checklist order', () => {
    const s = data.strategies[0];
    const { strategy, checklist } = strategyToRows(s, 'user');
    const back = rowsToStrategy({ ...strategy, updated_at: s.updatedAt }, [...checklist].reverse());
    expect(back).toEqual(s);
  });

  it('round-trips trades with checklist and journal', () => {
    const t = data.trades.find((x) => x.journaled)!;
    const { trade, checklist, journal } = tradeToRows(t, 'user');
    const back = rowsToTrade(trade, checklist, journal);
    expect(back).toEqual(t);
  });

  it('parses numeric strings from Postgres', () => {
    const t = data.trades[0];
    const { trade } = tradeToRows(t, 'user');
    const back = rowsToTrade({ ...trade, entry_price: String(t.entryPrice), pnl: String(t.pnl) }, [], undefined);
    expect(back.entryPrice).toBe(t.entryPrice);
    expect(back.pnl).toBe(t.pnl);
  });

  it('round-trips pending trades and auto-journal trade fields', () => {
    const p = data.pendingTrades[0];
    expect(rowToPending(pendingToRow(p, 'user'))).toEqual(p);
    const t = { ...data.trades[0], source: 'auto' as const, accountBalance: 25_000, pendingId: p.id, externalId: 'B-1' };
    const { trade, checklist, journal } = tradeToRows(t, 'user');
    expect(rowsToTrade(trade, checklist, journal)).toMatchObject({ source: 'auto', accountBalance: 25_000, pendingId: p.id, externalId: 'B-1' });
  });

  it('round-trips practice attempts and lessons (user-performance layer)', () => {
    const a = {
      id: 'a1', userId: 'user', scenarioId: 'sample-x', instrument: 'ES', strategyId: 'orb-15', strategyName: '15M ORB Retest',
      timestamp: '2026-10-01T14:00:00.000Z', mode: 'smart' as const, session: 'morning' as const, direction: 'long' as const,
      decision: 'long' as const, idealDecision: 'long' as const, correct: true, entry: 6029.25, stop: 6025.75, target: 6036.25,
      riskReward: 2, score: 92, grade: 'A+' as const, result: 'win' as const, mistakes: [], setupCharacteristics: { retestNumber: 1, trendAligned: true },
    };
    expect(rowToPracticeAttempt(practiceAttemptToRow(a, 'user'))).toEqual(a);
    const l = { id: 'l1', attemptId: 'a1', scenarioId: 'sample-x', strategyId: 'orb-15', strategyName: '15M ORB Retest', instrument: 'ES', score: 92, grade: 'A+' as const, lesson: 'Wait for the first retest.', createdAt: '2026-10-01T14:05:00.000Z' };
    expect(rowToPracticeLesson(practiceLessonToRow(l, 'user'))).toEqual(l);
  });
});
