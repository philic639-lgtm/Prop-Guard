import { makeAccount, makeTrade } from '@/test/fixtures';

import { useAppStore } from '../useAppStore';

/** V1 audit: the account balance must stay consistent with the journal. */
describe('journal ↔ account balance', () => {
  beforeEach(() => {
    useAppStore.getState().startFresh('local');
    useAppStore.getState().upsertAccount(makeAccount({ id: 'acc1', balance: 25000, highWaterMark: 25000 }));
  });
  const balance = () => useAppStore.getState().accounts.find((a) => a.id === 'acc1')!.balance;

  it('adding then deleting a closed trade returns the balance to where it was', () => {
    const t = makeTrade({ id: 't1', accountId: 'acc1', status: 'closed', pnl: -150 });
    useAppStore.getState().addJournalTrade(t);
    expect(balance()).toBe(24850);
    useAppStore.getState().deleteTrade('t1');
    expect(balance()).toBe(25000);
    expect(useAppStore.getState().trades).toHaveLength(0);
  });

  it('several trades on one account accumulate exactly (no float drift)', () => {
    for (const [i, pnl] of [[1, 101.1], [2, -50.35], [3, 0.25]] as const) useAppStore.getState().addJournalTrade(makeTrade({ id: `t${i}`, accountId: 'acc1', status: 'closed', pnl }));
    expect(balance()).toBe(25051);
  });

  it('editing the result of a closed trade moves the balance by the difference', () => {
    useAppStore.getState().addJournalTrade(makeTrade({ id: 't1', accountId: 'acc1', status: 'closed', pnl: 200 }));
    useAppStore.getState().updateTrade('t1', { pnl: 150 });
    expect(balance()).toBe(25150);
  });

  it('deleting an open (unrealized) trade does not touch the balance', () => {
    useAppStore.getState().openTrade(makeTrade({ id: 'o1', accountId: 'acc1', status: 'open', pnl: null, exitPrice: null, closedAt: null }));
    useAppStore.getState().deleteTrade('o1');
    expect(balance()).toBe(25000);
  });

  it('closing a trade books realized P&L from the instrument catalog (MES $5/pt)', () => {
    useAppStore.getState().openTrade(makeTrade({ id: 'o2', accountId: 'acc1', instrument: 'MES', direction: 'long', entryPrice: 5000, contracts: 2, status: 'open', pnl: null, exitPrice: null, closedAt: null }));
    const closed = useAppStore.getState().closeTrade('o2', 5004.25);
    expect(closed?.pnl).toBe(42.5);
    expect(balance()).toBe(25042.5);
  });
});
