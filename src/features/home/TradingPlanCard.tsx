import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { DailyGuard } from '@/lib/engines/dailyGuardEngine';
import { inEntryWindow } from '@/lib/engines/strategyEngine';
import { useAppStore } from '@/store/useAppStore';
import type { Strategy } from '@/types/domain';
import { formatClock } from '@/utils/dates';
import { money } from '@/utils/format';

interface Row {
  label: string;
  value: string;
  ok: boolean;
}

/** "Your Trading Plan" — the active strategy's hard limits at a glance. */
export function TradingPlanCard({ strategy, guard }: { strategy: Strategy; guard: DailyGuard | null }) {
  const rules = useAppStore((s) => s.tradingRules);
  const windowOpen = inEntryWindow(strategy, new Date());
  const rows: Row[] = [];
  if (strategy.entryWindowStart && strategy.entryWindowEnd) {
    rows.push({ label: 'Trading window', value: `${formatClock(strategy.entryWindowStart)} – ${formatClock(strategy.entryWindowEnd)}`, ok: windowOpen !== false });
  }
  rows.push({ label: 'Max risk per trade', value: money(rules.maxRiskPerTrade), ok: true });
  rows.push({
    label: 'Max trades',
    value: `${guard?.tradesTaken ?? 0} / ${Math.min(strategy.maxTrades, rules.maxTradesPerDay)}`,
    ok: (guard?.tradesTaken ?? 0) < Math.min(strategy.maxTrades, rules.maxTradesPerDay),
  });
  rows.push({ label: 'Min R:R', value: `1 : ${strategy.minRR}`, ok: true });

  return (
    <Card onPress={() => router.push({ pathname: '/strategy/review', params: { id: strategy.id } })} accessibilityLabel={`Your trading plan: ${strategy.name}`}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="heading">Your trading plan</AppText>
          <AppText variant="caption">{strategy.name}</AppText>
        </View>
        <StatusBadge label="Active" tone="positive" size="sm" />
      </View>
      <View style={styles.rows}>
        {rows.map((r) => (
          <View key={r.label} style={styles.row} accessible accessibilityLabel={`${r.label} ${r.value}${r.ok ? '' : ', limit reached or outside'}`}>
            <Ionicons name={r.ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={r.ok ? colors.positive : colors.warning} />
            <AppText variant="body" style={styles.flex}>
              {r.label}
            </AppText>
            <AppText variant="bodyStrong">{r.value}</AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  rows: { marginTop: spacing.md, gap: spacing.sm + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
