import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Card, EmptyState, HeaderIconButton, Metric, RiskProgress, Screen, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { spacing } from '@/constants/theme';
import { evaluateAccount } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import { money } from '@/utils/format';

export default function AccountsScreen() {
  const accounts = useAppStore((s) => s.accounts);
  const trades = useAppStore((s) => s.trades);
  const activeId = useAppStore((s) => s.activeAccountId);
  const setActive = useAppStore((s) => s.setActiveAccount);
  const plan = useSubscriptionStore((s) => s.plan);
  const canAdd = accounts.length < PLANS[plan].limits.accounts;

  const evals = useMemo(() => new Map(accounts.map((a) => [a.id, evaluateAccount(a, trades)])), [accounts, trades]);

  return (
    <Screen
      header={
        <AppHeader
          title="Accounts"
          back
          right={<HeaderIconButton icon="add" label="Add account" onPress={() => router.push(canAdd ? '/accounts/new' : '/paywall')} />}
        />
      }>
      {accounts.length === 0 ? (
        <EmptyState icon="briefcase-outline" title="No accounts" message="Add a prop or personal account to track its rules." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
      ) : (
        accounts.map((a) => {
          const ev = evals.get(a.id)!;
          const ddProximity = ev.rules.find((r) => r.id === 'max_drawdown')?.proximity ?? 0;
          return (
            <Card key={a.id} onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })} tone={a.id === activeId ? 'accent' : undefined}>
              <View style={styles.head}>
                <AppText variant="heading" style={styles.flex}>
                  {a.name}
                </AppText>
                <StatusBadge label={a.status} tone={a.status === 'active' ? 'positive' : a.status === 'failed' ? 'danger' : 'neutral'} size="sm" />
              </View>
              <View style={[styles.grid, { marginTop: spacing.lg }]}>
                <Metric label="Balance" value={money(a.balance)} compact />
                <Metric label="Target" value={a.rules.profitTarget ? money(a.cycleStartBalance + a.rules.profitTarget) : '—'} compact />
                <Metric label="DD buffer" value={money(ev.drawdownBuffer)} tone={ev.drawdownBuffer != null && ev.drawdownBuffer < 500 ? 'warning' : undefined} compact />
              </View>
              {ev.targetProgress != null ? (
                <View style={styles.progress}>
                  <AppText variant="caption">Target progress</AppText>
                  <RiskProgress value={ev.targetProgress} tone="positive" height={6} label="Profit target progress" />
                </View>
              ) : null}
              {ev.drawdownBuffer != null ? (
                <View style={styles.progress}>
                  <AppText variant="caption">Drawdown used</AppText>
                  <RiskProgress value={ddProximity} height={6} label="Drawdown used" />
                </View>
              ) : null}
              {a.id !== activeId ? (
                <AppText variant="caption" tone="accent" style={{ marginTop: spacing.md, fontWeight: '600' }} onPress={() => setActive(a.id)}>
                  Make active
                </AppText>
              ) : (
                <AppText variant="caption" tone="accent" style={{ marginTop: spacing.md }}>
                  Active account
                </AppText>
              )}
            </Card>
          );
        })
      )}
      {!canAdd ? (
        <AppText variant="caption" align="center">
          Free plan includes {PLANS.free.limits.accounts} account. Pro unlocks unlimited accounts.
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', gap: spacing.md },
  progress: { gap: 6, marginTop: spacing.md },
});
