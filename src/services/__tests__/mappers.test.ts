import { createDemoData } from '@/data/demo';

import { accountToRows, rowsToAccount, rowsToStrategy, rowsToTrade, strategyToRows, tradeToRows } from '../supabase/mappers';

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
});
