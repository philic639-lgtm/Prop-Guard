import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, EmptyState, HeaderIconButton, NotificationCard, Screen, SectionHeader } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useAppStore } from '@/store/useAppStore';
import { dayKey } from '@/utils/dates';
import { shortDate, time } from '@/utils/format';

/** In-app notification feed: entry confirmations, breakeven nudges, risk warnings, closes. */
export default function AlertsScreen() {
  const alerts = useAppStore((s) => s.alerts);
  const markRead = useAppStore((s) => s.markAlertsRead);
  const sorted = useMemo(() => [...alerts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [alerts]);
  const today = dayKey(new Date());
  const todays = sorted.filter((a) => dayKey(a.at) === today);
  const earlier = sorted.filter((a) => dayKey(a.at) !== today);

  useEffect(() => {
    const t = setTimeout(markRead, 1200);
    return () => clearTimeout(t);
  }, [markRead]);

  const open = (tradeId: string | null) => {
    if (!tradeId) return;
    const t = useAppStore.getState().trades.find((x) => x.id === tradeId);
    if (!t) return;
    router.push(t.status === 'open' ? { pathname: '/session/live', params: { id: t.id } } : { pathname: '/journal/[id]', params: { id: t.id } });
  };

  return (
    <Screen header={<AppHeader title="Alerts" back right={<HeaderIconButton icon="options-outline" label="Notification settings" onPress={() => router.push('/settings/notifications')} />} />}>
      {sorted.length === 0 ? (
        <EmptyState icon="notifications-outline" title="No alerts yet" message="Entry confirmations, breakeven nudges and risk warnings appear here while you trade." />
      ) : (
        <>
          {todays.length > 0 ? <SectionHeader title="Today" /> : null}
          <View style={styles.list}>
            {todays.map((a) => (
              <NotificationCard key={a.id} kind={a.kind} title={a.title} body={a.body} time={time(a.at)} unread={!a.read} onPress={a.tradeId ? () => open(a.tradeId) : undefined} />
            ))}
          </View>
          {earlier.length > 0 ? <SectionHeader title="Earlier" /> : null}
          <View style={styles.list}>
            {earlier.map((a) => (
              <NotificationCard key={a.id} kind={a.kind} title={a.title} body={a.body} time={`${shortDate(a.at)} ${time(a.at)}`} unread={!a.read} onPress={a.tradeId ? () => open(a.tradeId) : undefined} />
            ))}
          </View>
          <AppText variant="caption" tone="tertiary" align="center">
            Alerts are generated from your trade plan and price. Prop Guard never places or modifies orders.
          </AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: spacing.md } });
