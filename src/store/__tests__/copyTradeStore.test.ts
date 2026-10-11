import { buildCopiedTrade, DEFAULT_COPY_SETTINGS, filterByOrigin } from '@/lib/engines/copyTradeEngine';
import { copyTradeToRow, rowsToTrade, rowToCopyTrade, rowToSourceTrader, sourceTraderToRow, tradeToRows } from '@/services/supabase/mappers';
import { makeAccount, makeTrade } from '@/test/fixtures';
import type { CopyTrade, SourceTrader } from '@/types/copyTrade';

import { useAppStore } from '../useAppStore';

const AT = '2026-10-12T14:30:00.000Z';
const trader = (o: Partial<SourceTrader> = {}): SourceTrader => ({
  id: 'st1',
  name: 'Alpha',
  platform: 'discord',
  assetClass: 'futures',
  instruments: ['MNQ', 'NQ'],
  style: 'ORB',
  notes: '',
  trustRating: 4,
  isActive: true,
  archived: false,
  settings: { ...DEFAULT_COPY_SETTINGS, fixedRisk: 160 },
  createdAt: AT,
  updatedAt: AT,
  ...o,
});
const copy = (o: Partial<CopyTrade> = {}): CopyTrade => ({
  id: 'c1',
  sourceTraderId: 'st1',
  sourceTraderName: 'Alpha',
  accountId: 'acc1',
  instrument: 'MNQ',
  direction: 'long',
  entry: 20_000,
  stop: 19_980,
  target: 20_040,
  sourceContracts: 10,
  sourceInstrument: 'MNQ',
  at: AT,
  setup: 'ORB',
  notes: '',
  conviction: 'A',
  mode: 'live',
  screenshotUri: null,
  contracts: 4,
  translation: { verdict: 'safe', instrument: 'MNQ', contracts: 4, riskDollars: 160, dailyRiskRemaining: 600, reasons: [] },
  tradeId: null,
  outcome: null,
  lesson: '',
  createdAt: AT,
  updatedAt: AT,
  ...o,
});
const st = () => useAppStore.getState();

describe('Copy Trade store', () => {
  beforeEach(() => {
    st().startFresh('local');
    st().upsertAccount(makeAccount({ id: 'acc1', balance: 50_000 }));
    st().addJournalTrade(makeTrade({ id: 'own1', accountId: 'acc1', status: 'closed', pnl: 100, realizedR: 1 }));
  });

  it('1–3: create, edit settings, archive (history kept) and restore a source trader', () => {
    st().upsertSourceTrader(trader());
    expect(st().sourceTraders).toHaveLength(1);
    st().upsertSourceTrader({ ...st().sourceTraders[0], name: 'Alpha Futures', settings: { ...DEFAULT_COPY_SETTINGS, sizingMode: 'scale', scale: { source: 5, mine: 2 }, maxTradesPerDay: 3, allowedInstruments: ['MNQ'] } });
    expect(st().sourceTraders).toHaveLength(1);
    expect(st().sourceTraders[0]).toMatchObject({ name: 'Alpha Futures', settings: { sizingMode: 'scale', scale: { source: 5, mine: 2 }, maxTradesPerDay: 3, allowedInstruments: ['MNQ'] } });
    st().archiveSourceTrader('st1', true);
    expect(st().sourceTraders[0]).toMatchObject({ archived: true, isActive: false });
    st().archiveSourceTrader('st1', false);
    expect(st().sourceTraders[0].archived).toBe(false);
  });

  it('4–5: logging a live copy opens a journal trade with origin "copied"; 11: own trades and balance untouched', () => {
    st().upsertSourceTrader(trader());
    const c = copy();
    const trade = buildCopiedTrade(c, 'acc1', 50_100, 'tr-copy')!;
    st().logCopyTrade(c, trade);
    expect(st().copyTrades[0]).toMatchObject({ id: 'c1', tradeId: 'tr-copy', mode: 'live' });
    const t = st().trades.find((x) => x.id === 'tr-copy')!;
    expect(t).toMatchObject({ origin: 'copied', copyTradeId: 'c1', sourceTraderId: 'st1', sourceTraderName: 'Alpha', status: 'open', riskDollars: 160 });
    expect(st().accounts[0].balance).toBe(50_100); // opening does not move the balance
    const own = st().trades.find((x) => x.id === 'own1')!;
    expect(own.origin).toBeUndefined();
    expect(filterByOrigin(st().trades, 'self').map((x) => x.id)).toEqual(['own1']);
    expect(filterByOrigin(st().trades, 'copied').map((x) => x.id)).toEqual(['tr-copy']);
    // Closing books the result like any trade.
    st().closeTrade('tr-copy', 20_040);
    expect(st().accounts[0].balance).toBe(50_420);
  });

  it('simulated / missed copies are logged without a journal trade or balance change; outcome can be recorded', () => {
    st().logCopyTrade(copy({ id: 'c2', mode: 'missed' }), null);
    expect(st().trades.some((t) => t.copyTradeId === 'c2')).toBe(false);
    st().updateCopyTrade('c2', { outcome: { exitPrice: 20_040, pnl: 320, r: 2, closedAt: AT }, lesson: 'Waited too long.' });
    expect(st().copyTrades[0]).toMatchObject({ outcome: { pnl: 320 }, lesson: 'Waited too long.' });
    expect(st().accounts[0].balance).toBe(50_100);
    st().deleteCopyTrade('c2');
    expect(st().copyTrades).toHaveLength(0);
  });

  it('persists through the Supabase mappers (source trader, copy log, trade origin)', () => {
    const s = rowToSourceTrader(sourceTraderToRow(trader(), 'u1') as never);
    expect(s).toEqual(trader());
    const c = rowToCopyTrade(copyTradeToRow(copy({ tradeId: 'x' }), 'u1') as never);
    expect(c).toEqual(copy({ tradeId: 'x' }));
    const t = buildCopiedTrade(copy(), 'acc1', null, 'tt')!;
    const rows = tradeToRows(t, 'u1');
    expect(rows.trade).toMatchObject({ origin: 'copied', copy_trade_id: 'c1', source_trader_id: 'st1' });
    expect(rowsToTrade(rows.trade as never, [], undefined)).toMatchObject({ origin: 'copied', sourceTraderName: 'Alpha' });
    // Older rows without the columns stay the trader's own.
    const own = rowsToTrade(tradeToRows(makeTrade({ id: 'o' }), 'u1').trade as never, [], undefined);
    expect(own.origin).toBeUndefined();
  });
});
