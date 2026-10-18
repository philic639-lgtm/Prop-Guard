/**
 * Correct-account updates: a confirmed screenshot import saved for the SELECTED account changes
 * that one record only, survives a reload, and never touches the other accounts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyImport, confirmImport } from '@/lib/engines/accountImport';
import { syncService } from '@/services/syncService';
import { makeAccount, makeRules } from '@/test/fixtures';

import { confirmAccountSaved, useAppStore } from '../useAppStore';

jest.mock('@/services/supabase/client', () => ({ supabase: {} }));
jest.mock('@/services/supabase/repository', () => ({ SupabaseRepository: class {} }));

const NOW = new Date('2026-10-13T16:00:00Z');

beforeEach(async () => {
  syncService.detach();
  await AsyncStorage.clear();
  useAppStore.getState().startFresh('local' as never);
  useAppStore.setState({ user: null, tradingRules: makeRules() });
  useAppStore.getState().upsertAccount(makeAccount({ id: 'a', name: 'Eval A', balance: 25_000 }));
  useAppStore.getState().upsertAccount(makeAccount({ id: 'b', name: 'Eval B', balance: 25_000 }));
  useAppStore.getState().setActiveAccount('a');
});

it('updates only the selected account and the update survives a reload', async () => {
  const before = useAppStore.getState().accounts.find((x) => x.id === 'a')!;
  const target = useAppStore.getState().accounts.find((x) => x.id === 'b')!;
  const c = confirmImport({
    fields: { balance: { key: 'balance', value: 25_480, confidence: 0.95, source: 'ocr', evidence: 'Balance $25,480', page: 0 } },
    edited: new Set(),
    fingerprint: null,
    maskedId: null,
    engine: 'ocr',
    pages: 1,
    now: NOW,
  });
  const r = applyImport(target, c, 'imp-b');
  useAppStore.getState().upsertAccount(r.account);
  expect(await confirmAccountSaved(r.account)).toEqual({ ok: true, cloud: 'local_only' });

  const s = useAppStore.getState();
  expect(s.accounts).toHaveLength(2);
  expect(s.accounts.find((x) => x.id === 'b')!.balance).toBe(25_480);
  const a = s.accounts.find((x) => x.id === 'a')!;
  expect({ ...a, updatedAt: undefined }).toEqual({ ...before, updatedAt: undefined });

  const stored = await AsyncStorage.getItem('prop-guard-store');
  useAppStore.setState({ accounts: [], activeAccountId: null });
  await new Promise((res) => setTimeout(res, 0));
  await AsyncStorage.setItem('prop-guard-store', stored!);
  await useAppStore.persist.rehydrate();
  const after = useAppStore.getState().accounts;
  expect(after.map((x) => [x.id, x.balance])).toEqual([['a', 25_000], ['b', 25_480]]);
});
