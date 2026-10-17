/**
 * Regression — LucidFlex 25K: Edit Account Details showed $25,246 while the dashboard
 * showed $25,090. Save → stored record → dashboard numbers → reload → second update,
 * plus failed saves, cloud upload status and cloud hydration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyDetailEdits, detailValues } from '@/lib/engines/accountDetails';
import { computeDailyGuard } from '@/lib/engines/dailyGuardEngine';
import { drawdownFloor } from '@/lib/engines/propRuleEngine';
import { syncService } from '@/services/syncService';
import { makeAccount, makeRules, makeTrade } from '@/test/fixtures';
import type { Account } from '@/types/domain';

import { confirmAccountSaved, useAppStore } from '../useAppStore';

const mockRepo = { fail: false as boolean | string, writes: [] as number[] };
jest.mock('@/services/supabase/client', () => ({ supabase: {} }));
jest.mock('@/services/supabase/repository', () => ({
  SupabaseRepository: class {
    async upsertAccount(a: { balance: number }) {
      if (mockRepo.fail) throw new Error(typeof mockRepo.fail === 'string' ? mockRepo.fail : 'offline');
      mockRepo.writes.push(a.balance);
    }
    async savePreferences() {}
  },
}));

const NOW = new Date('2026-10-13T16:00:00Z');
const AT = '2026-10-13T15:00:00Z';
const PERSONAL_STOP = 400;

/** The LucidFlex 25K Evaluation as saved earlier: balance $25,090, confirmed floor $24,270. */
function lucidFlex(balance = 25_090): Account {
  return makeAccount({
    id: 'flex-25k',
    name: 'LucidFlex 25K Evaluation',
    firm: 'Lucid Trading',
    size: 25_000,
    startingBalance: 25_000,
    cycleStartBalance: 25_000,
    balance,
    highWaterMark: 25_270,
    rules: { dailyLossLimit: 600, maxDrawdown: 1_000, drawdownType: 'eod_trailing', profitTarget: 1_250 } as never,
    importState: {
      fingerprint: null,
      maskedId: null,
      reported: { at: AT, asOf: '2026-10-13', balance, drawdownThreshold: 24_270 } as never,
      history: [],
      threshold: { value: 24_270, source: 'screenshot', at: AT },
      origins: { balance: { source: 'screenshot', at: AT }, drawdownThreshold: { source: 'screenshot', at: AT } },
    },
  });
}

/** What the dashboard renders for the active account (Home tiles + Daily Guard). */
function dashboard() {
  const s = useAppStore.getState();
  const account = s.accounts.find((a) => a.id === s.activeAccountId) ?? s.accounts[0]!;
  const guard = computeDailyGuard({ account, rules: s.tradingRules, trades: s.trades, now: NOW });
  return { id: account.id, balance: account.balance, profit: account.balance - account.cycleStartBalance, floor: drawdownFloor(account), remaining: guard.drawdownBuffer, guard, count: s.accounts.length };
}

/** Edit Account Details → Save Changes, exactly as the screen does it. */
async function editBalance(balance: number) {
  const s = useAppStore.getState();
  const account = s.accounts.find((a) => a.id === 'flex-25k')!;
  const before = detailValues(account, PERSONAL_STOP);
  const r = applyDetailEdits(account, before, { ...before, balance }, NOW);
  s.upsertAccount(r.account);
  s.setActiveAccount(r.account.id);
  return confirmAccountSaved(r.account, { waitForCloudMs: 300 });
}

beforeEach(async () => {
  syncService.detach();
  mockRepo.fail = false;
  mockRepo.writes = [];
  await AsyncStorage.clear();
  useAppStore.getState().startFresh('local' as never);
  useAppStore.setState({ user: null, tradingRules: makeRules({ dailyStop: PERSONAL_STOP }) });
  useAppStore.getState().upsertAccount(lucidFlex());
  useAppStore.getState().upsertAccount(makeAccount({ id: 'other', name: 'Other 50K', size: 50_000, balance: 50_000 }));
  useAppStore.getState().setActiveAccount('other');
});

describe('device storage (no cloud account)', () => {
  it('saving $25,246 updates the one record the dashboard reads: profit +$246, remaining $976', async () => {
    const saved = await editBalance(25_246);
    expect(saved).toEqual({ ok: true, cloud: 'local_only' });
    const d = dashboard();
    expect(d).toMatchObject({ id: 'flex-25k', balance: 25_246, profit: 246, floor: 24_270, remaining: 976, count: 2 });
    // Personal daily stop, firm daily loss limit and what is left of each stay separate.
    expect(d.guard.personalDailyStop).toBe(PERSONAL_STOP);
    expect(d.guard.firmDailyLimit).toBe(600);
    expect(d.guard.dailyLimitSource).toBe('personal');
    expect(d.guard.firmDailyRoom).toBe(600);
  });

  it('values survive a reload (stored copy re-read from storage)', async () => {
    await editBalance(25_246);
    // Simulated reload: memory wiped, then the store is read back from device storage.
    const stored = await AsyncStorage.getItem('prop-guard-store');
    useAppStore.setState({ accounts: [], activeAccountId: null });
    await new Promise((r) => setTimeout(r, 0)); // let that (empty) write land first
    await AsyncStorage.setItem('prop-guard-store', stored!);
    await useAppStore.persist.rehydrate();
    expect(dashboard()).toMatchObject({ id: 'flex-25k', balance: 25_246, profit: 246, remaining: 976, count: 2 });
  });

  it('a second balance update refreshes every dependent number', async () => {
    await editBalance(25_246);
    await editBalance(25_400);
    const d = dashboard();
    expect(d).toMatchObject({ balance: 25_400, profit: 400, count: 2 });
    expect(d.remaining).toBe(25_400 - d.floor!);
    expect(d.floor).toBeGreaterThanOrEqual(24_270);
  });

  it('a failed device write is reported, never shown as saved', async () => {
    const original = AsyncStorage.setItem;
    AsyncStorage.setItem = jest.fn(() => Promise.reject(new Error('QuotaExceededError')));
    const saved = await editBalance(25_246);
    AsyncStorage.setItem = original;
    expect(saved).toEqual({ ok: false, error: expect.stringContaining('QuotaExceededError') });
  });

  it('a stored copy that does not match is not confirmed', async () => {
    const saved = await confirmAccountSaved({ ...lucidFlex(), balance: 25_999 });
    expect(saved.ok).toBe(false);
  });
});

describe('journal trades and the confirmed balance', () => {
  it('a trade that closed before the balance was confirmed is not counted twice', async () => {
    await editBalance(25_246);
    useAppStore.getState().addJournalTrade(makeTrade({ accountId: 'flex-25k', status: 'closed', pnl: -156, openedAt: '2026-10-13T13:00:00Z', closedAt: '2026-10-13T13:30:00Z' }));
    expect(dashboard().balance).toBe(25_246);
  });
  it('a trade closed after the confirmation moves the balance', async () => {
    await editBalance(25_246);
    useAppStore.getState().addJournalTrade(makeTrade({ accountId: 'flex-25k', status: 'closed', pnl: -156, openedAt: '2026-10-13T16:10:00Z', closedAt: '2026-10-13T16:30:00Z' }));
    expect(dashboard().balance).toBe(25_090);
  });
});

describe('trade screenshots', () => {
  it('a trade read from a trade screenshot is journaled but never moves the balance', async () => {
    await editBalance(25_246);
    useAppStore.getState().addJournalTrade(makeTrade({ accountId: 'flex-25k', status: 'closed', pnl: -156, source: 'screenshot', openedAt: '2026-10-13T16:10:00Z', closedAt: '2026-10-13T16:30:00Z' }));
    expect(dashboard().balance).toBe(25_246);
    expect(useAppStore.getState().trades.filter((t) => t.accountId === 'flex-25k')).toHaveLength(1);
    // Journals stay with their own account.
    expect(useAppStore.getState().trades.filter((t) => t.accountId === 'other')).toHaveLength(0);
  });
});

describe('cloud account', () => {
  beforeEach(() => {
    useAppStore.setState({ user: { id: 'u1', email: 'x@example.com' } });
    syncService.attach('u1');
  });

  it('confirmed as synced only after the server write succeeded', async () => {
    const saved = await editBalance(25_246);
    expect(saved).toEqual({ ok: true, cloud: 'synced' });
    expect(mockRepo.writes).toContain(25_246);
    expect(useAppStore.getState().sync.unsynced).toEqual([]);
  });

  it('a failed upload stays visible (pending + error), and older cloud data never replaces the local save', async () => {
    mockRepo.fail = 'new row violates row-level security policy';
    const saved = await editBalance(25_246);
    expect(saved).toEqual({ ok: true, cloud: 'pending' });
    expect(useAppStore.getState().sync.unsynced).toContain('account:flex-25k');
    expect(useAppStore.getState().sync.error).toMatch(/row-level security/);

    // Reload while the upload is still failing: the server still has $25,090.
    useAppStore.getState().hydrateFromCloud({ accounts: [lucidFlex(25_090)], activeAccountId: 'flex-25k' });
    expect(dashboard()).toMatchObject({ balance: 25_246, remaining: 976, count: 1 });

    // Connection back: retried, confirmed, and the status clears.
    mockRepo.fail = false;
    await syncService.retry();
    expect(useAppStore.getState().sync.unsynced).toEqual([]);
    expect(useAppStore.getState().sync.error).toBeNull();
    expect(mockRepo.writes.at(-1)).toBe(25_246);
  });

  it('once synced, a newer cloud row (another device) is shown', async () => {
    await editBalance(25_246);
    useAppStore.getState().hydrateFromCloud({ accounts: [lucidFlex(25_400)], activeAccountId: 'flex-25k' });
    expect(dashboard().balance).toBe(25_400);
  });
});

describe('deleting an account', () => {
  it('removes its journal data and unlinks records that only point at it', () => {
    const s = useAppStore.getState();
    s.setPreferences({ tradingProfile: { ...s.preferences.tradingProfile, primaryAccountId: 'flex-25k' } });
    useAppStore.setState({
      trades: [makeTrade({ id: 'mine', accountId: 'flex-25k' }), makeTrade({ id: 'keep', accountId: 'other' })],
      pendingTrades: [{ id: 'p1', accountId: 'flex-25k' }, { id: 'p2', accountId: 'other' }] as never,
      plans: [{ id: 'pl1', accountId: 'flex-25k' }] as never,
      setupChecks: [{ id: 'sc1', accountId: 'flex-25k' }] as never,
      copyTrades: [{ id: 'ct1', accountId: 'flex-25k' }] as never,
      copyGroups: [{ id: 'g1', masterAccountId: 'other', followers: [{ accountId: 'flex-25k' }, { accountId: 'x' }] }] as never,
    });
    useAppStore.getState().deleteAccount('flex-25k');
    const after = useAppStore.getState();
    expect(after.accounts.map((a) => a.id)).toEqual(['other']);
    expect(after.trades.map((t) => t.id)).toEqual(['keep']);
    expect(after.pendingTrades.map((t) => t.id)).toEqual(['p2']);
    expect(after.plans).toEqual([]);
    expect(after.setupChecks).toEqual([{ id: 'sc1', accountId: null }]);
    expect(after.copyTrades).toEqual([{ id: 'ct1', accountId: null }]);
    expect(after.copyGroups[0]!.followers).toEqual([{ accountId: 'x' }]);
    expect(after.preferences.tradingProfile.primaryAccountId).toBeNull();
  });
});
