import { makeAccount, makeRules, makeTrade } from '@/test/fixtures';
import type { CopyGroup } from '@/types/copyTrade';

import { canStartLive, connectionStatus, defaultFollower, newCopyGroup, previewCopy, transition, validateCopyGroup, withEvent } from '../accountCopierEngine';
import { computeDailyGuard } from '../dailyGuardEngine';

const NOW = new Date('2026-10-12T14:30:00Z');
const master = makeAccount({ id: 'm', name: 'Master 50K', rules: { dailyLossLimit: 1_000, maxDrawdown: 2_000, drawdownType: 'trailing', maxContracts: 10 } as never });
const f1 = makeAccount({ id: 'f1', name: 'Follower A', rules: { dailyLossLimit: 500, maxDrawdown: 1_500, drawdownType: 'trailing', maxContracts: 5 } as never });
const f2 = makeAccount({ id: 'f2', name: 'Follower B', rules: { dailyLossLimit: 1_000, maxDrawdown: 2_000, drawdownType: 'trailing', maxContracts: 10 } as never });
const accounts = [master, f1, f2];
const rules = makeRules({ maxRiskPerTrade: 1_000, dailyStop: 2_000, maxTradesPerDay: 5 });
const guards = (trades = [] as ReturnType<typeof makeTrade>[]) => new Map(accounts.map((a) => [a.id, computeDailyGuard({ account: a, rules, trades, now: NOW })]));
const group = (o: Partial<CopyGroup> = {}): CopyGroup => ({ ...newCopyGroup('g', NOW.toISOString()), masterAccountId: 'm', followers: [{ ...defaultFollower('f1'), multiplier: 2 }, { ...defaultFollower('f2'), multiplier: 0.5, dailyLossLimit: 100 }], ...o });

describe('account copier: linking and validation', () => {
  it('a valid master → followers setup has no issues', () => {
    expect(validateCopyGroup(group(), accounts)).toEqual([]);
  });

  it('flags a missing master, the master as follower, duplicates, bad multipliers and limits', () => {
    const msgs = (g: CopyGroup) => validateCopyGroup(g, accounts).map((i) => i.message).join(' | ');
    expect(msgs(group({ masterAccountId: null }))).toMatch(/Choose the master/);
    expect(msgs(group({ followers: [defaultFollower('m')] }))).toMatch(/is the master/);
    expect(msgs(group({ followers: [defaultFollower('f1'), defaultFollower('f1')] }))).toMatch(/linked twice/);
    expect(msgs(group({ followers: [{ ...defaultFollower('f1'), multiplier: 0 }] }))).toMatch(/multiplier/);
    expect(msgs(group({ followers: [{ ...defaultFollower('f1'), multiplier: 11 }] }))).toMatch(/at most 10/);
    expect(msgs(group({ followers: [{ ...defaultFollower('f1'), maxContracts: 0 }] }))).toMatch(/limits/);
    expect(msgs(group({ followers: [] }))).toMatch(/at least one follower/);
  });
});

describe('account copier: live execution is never claimed', () => {
  it('no broker → not connected, live start refused with the reason', () => {
    expect(connectionStatus(master, [])).toMatchObject({ state: 'not_connected', label: 'Not connected' });
    expect(canStartLive(group(), accounts, [])).toEqual({ ok: false, reason: expect.stringMatching(/needs a connected, supported broker/) });
  });

  it('even a registered broker cannot start live copying (no order routing exists yet)', () => {
    expect(canStartLive(group(), accounts, ['Tradovate']).ok).toBe(false);
  });

  it('pause / resume / stop change state and are recorded in the activity history', () => {
    let g = group();
    g = transition(g, 'pause', NOW.toISOString(), 'e1');
    expect(g.state).toBe('paused');
    g = transition(g, 'resume', NOW.toISOString(), 'e2');
    expect(g.state).toBe('setup'); // never "running" without a broker
    g = transition(g, 'stop', NOW.toISOString(), 'e3');
    expect(g.state).toBe('stopped');
    expect(g.activity.slice(0, 3).map((e) => e.kind)).toEqual(['stopped', 'resumed', 'paused']);
    const many = Array.from({ length: 150 }).reduce<CopyGroup>((acc, _, i) => withEvent(acc, { id: `x${i}`, at: NOW.toISOString(), kind: 'settings', detail: 'x' }), g);
    expect(many.activity).toHaveLength(100);
  });
});

describe('account copier: follower sizing preview', () => {
  it('multipliers, contract caps, per-account loss limits and risk room', () => {
    // 3 MNQ, 20-pt stop = $40 / contract.
    const p = previewCopy(group(), { instrument: 'MNQ', direction: 'long', contracts: 3, entry: 20_000, stop: 19_980 }, accounts, guards());
    expect(p.ok).toBe(true);
    expect(p.masterRisk).toBe(120);
    const a = p.rows.find((r) => r.accountId === 'f1')!;
    expect(a).toMatchObject({ desired: 6, contracts: 5, status: 'reduced', riskDollars: 200 }); // account cap 5
    const b = p.rows.find((r) => r.accountId === 'f2')!;
    expect(b).toMatchObject({ desired: 1, contracts: 1, status: 'ok', riskDollars: 40 });
  });

  it('a per-account loss limit smaller than one contract blocks that follower', () => {
    const p = previewCopy(group(), { instrument: 'NQ', direction: 'long', contracts: 2, entry: 20_000, stop: 19_990 }, accounts, guards());
    expect(p.rows.find((r) => r.accountId === 'f2')).toMatchObject({ contracts: 0, status: 'blocked' }); // $200/ct > $100 limit
  });

  it('an account at its daily stop is blocked; without entry/stop the risk needs review', () => {
    const lost = [makeTrade({ accountId: 'f1', status: 'closed', pnl: -600, closedAt: NOW.toISOString(), openedAt: NOW.toISOString() })];
    const p = previewCopy(group(), { instrument: 'MNQ', direction: 'long', contracts: 1, entry: 20_000, stop: 19_980 }, accounts, guards(lost));
    expect(p.rows.find((r) => r.accountId === 'f1')).toMatchObject({ status: 'blocked' });
    const q = previewCopy(group(), { instrument: 'MNQ', direction: 'long', contracts: 1, entry: null, stop: null }, accounts, guards());
    expect(q.rows.every((r) => r.status === 'review' || r.contracts === 0)).toBe(true);
  });

  it('refuses invalid inputs instead of guessing', () => {
    expect(previewCopy(group({ masterAccountId: null }), { instrument: 'MNQ', direction: 'long', contracts: 1, entry: 1, stop: 0 }, accounts, guards()).ok).toBe(false);
    expect(previewCopy(group(), { instrument: 'MNQ', direction: 'long', contracts: 1.5, entry: null, stop: null }, accounts, guards()).error).toMatch(/whole number/);
    expect(previewCopy(group(), { instrument: 'MNQ', direction: 'long', contracts: 1, entry: 100, stop: 110 }, accounts, guards()).error).toMatch(/wrong side/);
  });
});
