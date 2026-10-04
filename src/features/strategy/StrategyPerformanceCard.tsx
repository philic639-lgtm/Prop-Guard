import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { MIN_TRADES_FOR_INSIGHT, UNASSIGNED, type StrategyPerformanceRow } from '@/lib/engines';
import { money, rMultiple } from '@/utils/format';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** "Your strategy performance" — computed only from the trader's own journaled trades. */
export function StrategyPerformanceCard({ rows, insight, limit }: { rows: StrategyPerformanceRow[]; insight: string | null; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  return (
    <Card>
      {shown.map((r, i) => (
        <View
          key={r.key}
          style={[styles.row, i > 0 && styles.border]}
          accessible
          accessibilityLabel={`${r.name}: ${r.trades} trades, win rate ${pct(r.winRate)}, average ${rMultiple(r.avgR)}`}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" tone={r.key === UNASSIGNED ? 'secondary' : undefined}>
              {r.name}
            </AppText>
            <AppText variant="caption">
              Trades: {r.trades} · Win rate: {pct(r.winRate)} · Avg {rMultiple(r.avgR)}
            </AppText>
            {r.trades < MIN_TRADES_FOR_INSIGHT && r.key !== UNASSIGNED ? (
              <AppText variant="caption" tone="tertiary" style={{ fontSize: 11 }}>
                Small sample — keep journaling
              </AppText>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <AppText variant="bodyStrong" tone={r.netR > 0 ? 'positive' : r.netR < 0 ? 'danger' : undefined}>
              {rMultiple(r.netR)}
            </AppText>
            <AppText variant="caption">{money(r.netPnl, { sign: true })}</AppText>
          </View>
        </View>
      ))}
      {rows.some((r) => r.key === UNASSIGNED) ? (
        <AppText variant="caption" style={{ marginTop: spacing.sm }} onPress={() => router.push('/journal')}>
          Trades marked “Strategy not assigned” can be assigned from their journal entry.
        </AppText>
      ) : null}
      {insight ? (
        <View style={styles.insight}>
          <Ionicons name="sparkles" size={14} color={colors.accentBright} />
          <AppText variant="caption" style={styles.flex}>
            {insight}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  flex: { flex: 1 },
  insight: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'flex-start' },
});
