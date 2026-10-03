import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TradeCard } from '@/components/domain/TradeCard';
import { AppHeader, AppText, Button, Card, Chip, EmptyState, HeaderIconButton } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { colors, GUTTER, spacing, TAB_BAR_HEIGHT } from '@/constants/theme';
import { MonthCalendar } from '@/features/journal/MonthCalendar';
import { useAccountTrades } from '@/hooks/useAppData';
import { dailyPnl } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import type { Trade } from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { money } from '@/utils/format';

type Outcome = 'all' | 'wins' | 'losses' | 'pending';
const PAGE = 20;

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const trades = useAccountTrades();
  const strategies = useAppStore((s) => s.strategies);
  const plan = useSubscriptionStore((s) => s.plan);
  const [outcome, setOutcome] = useState<Outcome>('all');
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [visible, setVisible] = useState(PAGE);

  const names = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const pnlByDay = useMemo(() => dailyPnl(trades), [trades]);
  const instruments = useMemo(() => [...new Set(trades.map((t) => t.instrument))], [trades]);
  const limit = PLANS[plan].limits.journalTrades;

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (outcome === 'wins' && !((t.pnl ?? 0) > 0)) return false;
      if (outcome === 'losses' && !((t.pnl ?? 0) < 0)) return false;
      if (outcome === 'pending' && (t.journaled || t.status !== 'closed')) return false;
      if (strategyId && t.strategyId !== strategyId) return false;
      if (instrument && t.instrument !== instrument) return false;
      if (day && dayKey(t.openedAt) !== day) return false;
      return true;
    });
  }, [trades, outcome, strategyId, instrument, day]);

  const capped = filtered.slice(0, Math.min(visible, limit));
  const hitPlanLimit = filtered.length > limit && visible >= limit;
  const monthNet = useMemo(() => {
    let sum = 0;
    for (const [k, v] of pnlByDay) if (k.startsWith(dayKey(month).slice(0, 7))) sum += v;
    return sum;
  }, [pnlByDay, month]);

  const renderItem = useCallback(
    ({ item }: { item: Trade }) => (
      <TradeCard
        trade={item}
        strategyName={item.strategyId ? names.get(item.strategyId) : null}
        onPress={() => router.push(item.status === 'open' ? { pathname: '/session/live', params: { id: item.id } } : { pathname: '/journal/[id]', params: { id: item.id } })}
      />
    ),
    [names],
  );

  const header = (
    <View style={styles.headerContent}>
      <MonthCalendar
        month={month}
        pnlByDay={pnlByDay}
        selected={day}
        onSelect={setDay}
        onMonthChange={(d) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + d, 1))}
      />
      <View style={styles.monthNet}>
        <AppText variant="caption">Month net</AppText>
        <AppText variant="bodyStrong" tone={monthNet > 0 ? 'positive' : monthNet < 0 ? 'danger' : 'secondary'}>
          {money(monthNet, { sign: true })}
        </AppText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {(['all', 'wins', 'losses', 'pending'] as Outcome[]).map((o) => (
          <Chip key={o} label={o === 'pending' ? 'Needs notes' : o[0].toUpperCase() + o.slice(1)} selected={outcome === o} onPress={() => setOutcome(o)} />
        ))}
      </ScrollView>
      {strategies.length > 1 || instruments.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {strategies.map((s) => (
            <Chip key={s.id} label={s.name} selected={strategyId === s.id} onPress={() => setStrategyId(strategyId === s.id ? null : s.id)} />
          ))}
          {instruments.map((i) => (
            <Chip key={i} label={i} selected={instrument === i} onPress={() => setInstrument(instrument === i ? null : i)} />
          ))}
        </ScrollView>
      ) : null}
      {day ? (
        <Chip label={`${new Date(day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ✕`} selected onPress={() => setDay(null)} />
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <AppHeader title="Journal" right={<HeaderIconButton icon="stats-chart-outline" label="Analytics" onPress={() => router.push('/analytics')} />} />
      <FlatList
        data={capped}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xxl }]}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.4}
        onEndReached={() => setVisible((v) => (v < filtered.length ? v + PAGE : v))}
        ListEmptyComponent={
          <Card>
            {trades.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title="No trades yet"
                message="Your journal will automatically organize your trading history."
                actionLabel="Start first session"
                onAction={() => router.push('/session')}
              />
            ) : (
              <EmptyState icon="filter-outline" title="Nothing matches" message="Try a different filter or day." />
            )}
          </Card>
        }
        ListFooterComponent={
          hitPlanLimit ? (
            <Card style={{ marginTop: spacing.md }}>
              <AppText variant="bodyStrong">Free journal shows your latest {limit} trades.</AppText>
              <Button label="Unlock unlimited journal" size="md" onPress={() => router.push('/paywall')} style={{ marginTop: spacing.md }} />
            </Card>
          ) : null
        }
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: spacing.md }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: GUTTER },
  headerContent: { gap: spacing.md, marginBottom: spacing.md },
  monthNet: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  filters: { gap: spacing.sm },
});
