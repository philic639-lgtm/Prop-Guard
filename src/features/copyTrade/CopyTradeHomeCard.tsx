import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { money } from '@/utils/format';

import { useCopyAnalytics } from './useCopyTrade';

/** Dashboard summary: active source traders, copies today, best performer, today's copy P&L, Log Copy Trade. */
export function CopyTradeHomeCard() {
  const a = useCopyAnalytics();
  if (a.traders.length === 0) {
    return (
      <Card accent="accent">
        <Pressable accessibilityRole="button" accessibilityLabel="Copy Trade — set up" onPress={() => router.push('/copy')} style={styles.intro}>
          <View style={styles.icon}>
            <Ionicons name="layers-outline" size={20} color={colors.accentBright} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">Copy Trade</AppText>
            <AppText variant="caption">Follow other traders without oversizing — Prop Guard translates their trades to your account limits.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
      </Card>
    );
  }
  return (
    <Card accent="accent">
      <Pressable accessibilityRole="button" accessibilityLabel="Open Copy Trade" onPress={() => router.push('/copy')} style={styles.head}>
        <Ionicons name="layers-outline" size={18} color={colors.accentBright} />
        <AppText variant="label" tone="accent" style={styles.flex}>
          Copy Trade
        </AppText>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>
      <View style={styles.grid}>
        <Stat label="Active traders" value={String(a.activeTraders)} />
        <Stat label="Copied today" value={String(a.copiedToday)} />
        <Stat label="Copy P&L today" value={a.copiedToday ? money(a.todayPnl, { sign: true }) : '—'} tone={a.todayPnl > 0 ? colors.positive : a.todayPnl < 0 ? colors.danger : undefined} />
      </View>
      <AppText variant="caption" tone="secondary" numberOfLines={1}>
        Best performer: {a.best ? `${a.best.name} · ${a.best.avgR!.toFixed(2)}R avg` : 'needs 3 closed copies'}
      </AppText>
      <Button label="Log Copy Trade" icon="add-circle-outline" variant="secondary" size="md" onPress={() => router.push('/copy/log')} style={styles.btn} />
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="number" style={tone ? { color: tone } : null} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" tone="tertiary" numberOfLines={1} style={styles.statLabel}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  stat: { flex: 1, minWidth: 0, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, gap: 2 },
  statLabel: { fontSize: 11 },
  btn: { marginTop: spacing.md },
});
