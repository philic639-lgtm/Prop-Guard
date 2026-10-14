import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Chip, EmptyState, HeaderIconButton, Input, Screen, Sheet, ToggleRow } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { spacing } from '@/constants/theme';
import { AccountCardView } from '@/features/accounts/AccountCardView';
import { UpdateAccountSheet } from '@/features/accounts/UpdateAccountSheet';
import { useAccountCards } from '@/hooks/useAppData';
import { FILTER_LABEL, filterCounts, overview, type AccountFilter } from '@/lib/engines/accountOverview';
import { confirmAccountSaved, useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import type { Account } from '@/types/domain';

const FILTERS: AccountFilter[] = ['all', 'attention', 'evaluation', 'funded', 'recent'];

/**
 * My Accounts — every account as a compact card (never stacked dashboards). Tap a card to
 * open its full dashboard (it becomes the active account: Home, Check Trade, Risk Manager,
 * Journal and Strategies all follow it). Filters, primary account, rename and archive here;
 * "Update" updates one account, "Update multiple" several at once.
 */
export default function MyAccountsScreen() {
  const accounts = useAppStore((s) => s.accounts);
  const setActive = useAppStore((s) => s.setActiveAccount);
  const upsert = useAppStore((s) => s.upsertAccount);
  const prefs = useAppStore((s) => s.preferences);
  const setPreferences = useAppStore((s) => s.setPreferences);
  const plan = useSubscriptionStore((s) => s.plan);
  const canAdd = accounts.length < PLANS[plan].limits.accounts;
  const cards = useAccountCards();
  const [filter, setFilter] = useState<AccountFilter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [updating, setUpdating] = useState<Account | null>(null);
  const [menu, setMenu] = useState<Account | null>(null);
  const [rename, setRename] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => filterCounts(cards, now), [cards, now]);
  const list = useMemo(() => overview(cards, filter, { showArchived, now }), [cards, filter, showArchived, now]);
  const archived = cards.filter((c) => c.status === 'archived').length;
  const byId = (id: string) => accounts.find((a) => a.id === id) ?? null;

  const open = (id: string) => {
    setActive(id);
    router.push('/home');
  };
  const saveAccount = async (a: Account, done: string) => {
    upsert(a);
    const r = await confirmAccountSaved(a);
    setNote(r.ok ? done : r.error);
  };
  const setPrimary = (id: string | null) => setPreferences({ tradingProfile: { ...prefs.tradingProfile, primaryAccountId: id } });

  return (
    <Screen
      header={
        <AppHeader
          title="My Accounts"
          subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
          back
          right={<HeaderIconButton icon="add" label="Add account" onPress={() => router.push(canAdd ? '/accounts/new' : '/paywall')} />}
        />
      }>
      {accounts.length === 0 ? (
        <EmptyState illustration="shield" title="No accounts" message="Add a prop or personal account to track its rules." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
      ) : (
        <>
          {accounts.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {FILTERS.map((f) => (
                <Chip key={f} label={`${FILTER_LABEL[f]} ${counts[f]}`} selected={filter === f} onPress={() => setFilter(f)} />
              ))}
            </ScrollView>
          ) : null}
          {accounts.length > 1 ? <Button label="Update Multiple Accounts" icon="images-outline" variant="secondary" size="md" onPress={() => router.push('/accounts/bulk')} /> : null}
          {note ? (
            <AppText variant="caption" tone="secondary" accessibilityRole="alert">
              {note}
            </AppText>
          ) : null}
          {list.length === 0 ? (
            <AppText variant="caption" tone="secondary" align="center" style={styles.empty}>
              No accounts in “{FILTER_LABEL[filter]}”.
            </AppText>
          ) : null}
          <View style={styles.list}>
            {list.map((c) => (
              <AccountCardView
                key={c.id}
                card={c}
                onOpen={() => open(c.id)}
                onUpdate={c.status === 'archived' ? undefined : () => setUpdating(byId(c.id))}
                onMore={() => {
                  const a = byId(c.id);
                  setRename(a?.name ?? '');
                  setMenu(a);
                }}
              />
            ))}
          </View>
          {archived ? <ToggleRow label={`Show archived accounts (${archived})`} value={showArchived} onChange={setShowArchived} /> : null}
        </>
      )}
      {!canAdd ? (
        <AppText variant="caption" align="center">
          Free plan includes {PLANS.free.limits.accounts} account. Pro unlocks unlimited accounts.
        </AppText>
      ) : null}

      {updating ? <UpdateAccountSheet account={updating} visible onClose={() => setUpdating(null)} /> : null}

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.name}>
        {menu ? (
          <View style={styles.gap}>
            <Input accessibilityLabel="Account name" label="Account name" value={rename} onChangeText={setRename} maxLength={60} />
            <Button
              label="Save name"
              variant="secondary"
              size="md"
              disabled={!rename.trim() || rename.trim() === menu.name}
              onPress={() => {
                void saveAccount({ ...menu, name: rename.trim() }, `Renamed to “${rename.trim()}”.`);
                setMenu(null);
              }}
            />
            {prefs.tradingProfile.primaryAccountId === menu.id ? (
              <Button label="Remove as primary account" variant="ghost" icon="star-outline" onPress={() => (setPrimary(null), setMenu(null))} />
            ) : (
              <Button label="Make primary account" variant="ghost" icon="star-outline" onPress={() => (setPrimary(menu.id), setMenu(null))} />
            )}
            <Button label="Edit Account Details" variant="ghost" icon="create-outline" onPress={() => (setMenu(null), router.push({ pathname: '/accounts/details', params: { id: menu.id } }))} />
            <Button label="Firm rules" variant="ghost" icon="rules-drawdown" onPress={() => (setMenu(null), router.push({ pathname: '/accounts/[id]', params: { id: menu.id } }))} />
            {menu.status === 'archived' ? (
              <Button label="Restore account" variant="ghost" icon="archive-outline" onPress={() => (void saveAccount({ ...menu, status: 'active' }, `“${menu.name}” restored.`), setMenu(null))} />
            ) : (
              <Button
                label="Archive account"
                variant="ghost"
                icon="archive-outline"
                onPress={() => {
                  void saveAccount({ ...menu, status: 'archived' }, `“${menu.name}” archived — its journal and history are kept. Show archived accounts to restore it.`);
                  if (prefs.tradingProfile.primaryAccountId === menu.id) setPrimary(null);
                  setMenu(null);
                }}
              />
            )}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: spacing.sm, paddingVertical: spacing.xs },
  list: { gap: spacing.sm },
  gap: { gap: spacing.sm },
  empty: { marginVertical: spacing.lg },
});
