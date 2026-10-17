import { createDemoData } from '@/data/demo';
import type { PendingTrade, Trade } from '@/types/domain';

import {
  brokerTradeToJournal,
  buildPendingTrade,
  completePendingTrade,
  matchPendingTrade,
  planBrokerImport,
  resolveResult,
  samePendingPlan,
  tradeOutcome,
  type BrokerClosedTrade,
} from '../journalEngine';

const NOW = new Date('2026-10-05T14:00:00.000Z');

function pending(overrides: Partial<Parameters<typeof buildPendingTrade>[0]> = {}): PendingTrade {
  const p = buildPendingTrade({
    id: 'p1',
    accountId: 'acc',
    strategyId: 'strat',
    instrument: 'MES',
    direction: 'long',
    entry: 6742.5,
    stop: 6737.5,
    target: 6752.5,
    contracts: 2,
    accountBalance: 25_000,
    origin: 'analyze',
    bias: 'bullish',
    checklist: [{ itemId: 'c1', label: 'Retest held', value: true }],
    rulesFollowed: ['risk_per_trade'],
    rulesViolated: [],
    setupScore: 100,
    setupGrade: 'A_PLUS',
    notes: '  ORB retest  ',
    now: NOW,
    ...overrides,
  });
  if (!p) throw new Error('invalid pending');
  return p;
}

let n = 0;
const newId = () => `t${++n}`;

describe('buildPendingTrade', () => {
  it('snapshots the plan with risk computed from instrument metadata', () => {
    const p = pending();
    expect(p.status).toBe('pending');
    expect(p.riskDollars).toBe(50); // 5 pts × $5 × 2
    expect(p.rewardDollars).toBe(100);
    expect(p.rr).toBe(2);
    expect(p.notes).toBe('ORB retest');
    expect(p.createdAt).toBe(NOW.toISOString());
  });

  it('returns null for an invalid trade', () => {
    const base = { id: 'x', accountId: 'acc', strategyId: null, instrument: 'MES', direction: 'long' as const, target: null, contracts: 1, accountBalance: null, origin: 'calculator' as const, now: NOW };
    expect(buildPendingTrade({ ...base, entry: 6742.5, stop: 6750 })).toBeNull(); // stop above a long entry
    expect(buildPendingTrade({ ...base, entry: null, stop: 6740 })).toBeNull();
  });

  it('detects unchanged plans so re-checks do not rewrite', () => {
    expect(samePendingPlan(pending(), pending({ now: new Date(NOW.getTime() + 60_000) }))).toBe(true);
    expect(samePendingPlan(pending(), pending({ contracts: 3 }))).toBe(false);
  });
});

describe('resolveResult', () => {
  const p = pending();
  it('target / stop / breakeven', () => {
    expect(resolveResult(p, { kind: 'target' }, p.entry, 2)).toEqual({ exitPrice: 6752.5, pnl: 100, points: 10 });
    expect(resolveResult(p, { kind: 'stop' }, p.entry, 2)).toEqual({ exitPrice: 6737.5, pnl: -50, points: -5 });
    expect(resolveResult(p, { kind: 'breakeven' }, p.entry, 2)).toEqual({ exitPrice: 6742.5, pnl: 0, points: 0 });
  });

  it('derives the exit from a dollar P&L', () => {
    expect(resolveResult(p, { kind: 'pnl', pnl: 75 }, p.entry, 2)).toEqual({ exitPrice: 6750, pnl: 75, points: 7.5 });
    const short = pending({ direction: 'short', stop: 6747.5, target: 6732.5 });
    expect(resolveResult(short, { kind: 'pnl', pnl: -25 }, short.entry, 2)).toMatchObject({ exitPrice: 6745 });
  });

  it('prices any catalog contract (CL)', () => {
    const cl = pending({ instrument: 'CL', entry: 78.5, stop: 78.3, target: 78.9, contracts: 1 });
    expect(resolveResult(cl, { kind: 'exit', exitPrice: 78.75 }, 78.5, 1)).toEqual({ exitPrice: 78.75, pnl: 250, points: 0.25 });
  });

  it('explains missing data', () => {
    expect(resolveResult(pending({ target: null }), { kind: 'target' }, 6742.5, 2)).toHaveProperty('error');
    expect(resolveResult(p, { kind: 'exit', exitPrice: NaN }, p.entry, 2)).toHaveProperty('error');
  });
});

describe('completePendingTrade', () => {
  it('auto-populates every journal field from the pending snapshot', () => {
    const p = pending({ ruleEvents: [{ type: 'STRATEGY_VIOLATION', category: 'entry', detail: 'x' }] });
    const t = completePendingTrade(p, { tradeId: 'T', result: { kind: 'target' }, closedAt: '2026-10-05T14:20:00.000Z', emotion: 'calm', followedPlan: true }) as Trade;
    expect(t).toMatchObject({
      id: 'T',
      accountId: 'acc',
      strategyId: 'strat',
      instrument: 'MES',
      direction: 'long',
      entryPrice: 6742.5,
      stopPrice: 6737.5,
      targetPrice: 6752.5,
      exitPrice: 6752.5,
      contracts: 2,
      accountBalance: 25_000,
      riskDollars: 50,
      rewardDollars: 100,
      rMultiple: 2,
      realizedR: 2,
      pnl: 100,
      status: 'closed',
      openedAt: NOW.toISOString(),
      closedAt: '2026-10-05T14:20:00.000Z',
      bias: 'bullish',
      setupGrade: 'A_PLUS',
      source: 'auto',
      journaled: true,
      pendingId: 'p1',
      disciplineScore: 75,
      emotion: 'calm',
      notes: 'ORB retest',
    });
    expect(t.checklist).toEqual(p.checklist);
    expect(tradeOutcome(t.pnl)).toBe('win');
  });

  it('recomputes risk for a different fill', () => {
    const t = completePendingTrade(pending(), { tradeId: 'T', result: { kind: 'stop' }, entryFill: 6743.5, contracts: 1, closedAt: NOW.toISOString() }) as Trade;
    expect(t.riskDollars).toBe(30); // 6 pts × $5
    expect(t.pnl).toBe(-30);
    expect(t.realizedR).toBe(-1);
  });
});

describe('broker import', () => {
  const bt = (o: Partial<BrokerClosedTrade> = {}): BrokerClosedTrade => ({
    externalId: 'B1',
    instrument: 'MES',
    direction: 'long',
    entryPrice: 6742.75,
    exitPrice: 6752.5,
    contracts: 2,
    openedAt: '2026-10-05T14:03:00.000Z',
    closedAt: '2026-10-05T14:25:00.000Z',
    ...o,
  });

  it('matches a broker fill to the pending plan it executed', () => {
    expect(matchPendingTrade([pending()], bt(), 'acc')?.id).toBe('p1');
    expect(matchPendingTrade([pending()], bt({ direction: 'short' }), 'acc')).toBeNull();
    expect(matchPendingTrade([pending()], bt({ entryPrice: 6760 }), 'acc')).toBeNull();
    expect(matchPendingTrade([pending()], bt({ openedAt: '2026-10-06T14:03:00.000Z' }), 'acc')).toBeNull();
    expect(matchPendingTrade([pending()], bt(), 'other')).toBeNull();
  });

  it('completes pending plans, imports unknown trades and skips duplicates', () => {
    const existing = { ...brokerTradeToJournal(bt({ externalId: 'OLD' }), 'acc', 'x') };
    const { actions, skipped } = planBrokerImport({
      accountId: 'acc',
      brokerTrades: [bt(), bt({ externalId: 'B2', instrument: 'NQ', entryPrice: 20000, exitPrice: 19990, contracts: 1, pnl: -205.5 }), bt({ externalId: 'OLD' })],
      pendings: [pending()],
      trades: [existing],
      newId,
    });
    expect(skipped).toEqual(['OLD']);
    const done = actions.find((a) => a.kind === 'complete-pending');
    expect(done && done.kind === 'complete-pending' && done.trade).toMatchObject({ source: 'broker', externalId: 'B1', entryPrice: 6742.75, pnl: 97.5, strategyId: 'strat', journaled: true });
    const imported = actions.find((a) => a.kind === 'import-new');
    expect(imported && imported.kind === 'import-new' && imported.trade).toMatchObject({ source: 'broker', instrument: 'NQ', pnl: -205.5, journaled: false, strategyId: null });
  });

  it('closes a trade open in the live monitor instead of duplicating it', () => {
    const p = { ...pending(), status: 'entered' as const, tradeId: 'open1' };
    const open = { ...createDemoData(NOW).trades[0], id: 'open1', status: 'open' as const };
    const { actions } = planBrokerImport({ accountId: 'acc', brokerTrades: [bt()], pendings: [p], trades: [open], newId });
    expect(actions).toEqual([{ kind: 'close-open', pendingId: 'p1', tradeId: 'open1', exitPrice: 6752.5, closedAt: bt().closedAt, externalId: 'B1', pnl: null }]);
  });

  it('assigns the pre-trade session strategy to unmatched broker trades', () => {
    const { actions } = planBrokerImport({
      accountId: 'acc',
      brokerTrades: [bt({ externalId: 'B9', instrument: 'NQ', entryPrice: 20000, exitPrice: 20010, contracts: 1 })],
      pendings: [],
      trades: [],
      newId,
      strategyFor: () => ({ id: 'strat', name: '15M ORB Retest' }),
    });
    expect(actions[0].kind === 'import-new' && actions[0].trade).toMatchObject({ strategyId: 'strat', strategyName: '15M ORB Retest' });
  });
});
