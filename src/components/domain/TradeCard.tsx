import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { Trade } from '@/types/domain';
import { money, points, shortDate, time } from '@/utils/format';

import { pnlTone } from './guardUi';

interface TradeCardProps {
  trade: Trade;
  strategyName?: string | null;
  onPress?: () => void;
}

function TradeCardBase({ trade, strategyName, onPress }: TradeCardProps) {
  const tone = pnlTone(trade.pnl);
  const discipline = trade.disciplineScore ?? 100;
  const label = `${trade.instrument} ${trade.direction}, ${trade.status === 'open' ? 'open' : money(trade.pnl, { sign: true })}`;
  return (
    <Card onPress={onPress} accessibilityLabel={label}>
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.titleRow}>
            <AppText variant="heading">{trade.instrument}</AppText>
            <View style={[styles.dir, { backgroundColor: trade.direction === 'long' ? colors.positiveMuted : colors.dangerMuted }]}>
              <Ionicons name={trade.direction === 'long' ? 'arrow-up' : 'arrow-down'} size={12} color={trade.direction === 'long' ? colors.positive : colors.danger} />
              <AppText variant="label" style={{ fontSize: 10, color: trade.direction === 'long' ? colors.positive : colors.danger }}>
                {trade.direction}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" tone="tertiary">
            {shortDate(trade.openedAt)} · {time(trade.openedAt)} · {trade.contracts} ct
          </AppText>
        </View>
        {trade.status === 'open' ? (
          <StatusBadge label="Live" tone="accent" />
        ) : (
          <View style={styles.right}>
            <AppText variant="number" tone={tone}>
              {money(trade.pnl, { sign: true })}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {points(trade.points, true)}
            </AppText>
          </View>
        )}
      </View>
      <View style={styles.footer}>
        <AppText variant="caption" numberOfLines={1} style={styles.flex}>
          {strategyName ?? trade.strategyName ?? 'Strategy not assigned'}
        </AppText>
        <View style={styles.meta}>
          {trade.screenshotUri ? <Image source={{ uri: trade.screenshotUri }} style={styles.thumb} contentFit="cover" accessibilityLabel="Screenshot" /> : null}
          <Ionicons name={discipline >= 100 ? 'shield-checkmark' : 'shield-half'} size={14} color={discipline >= 100 ? colors.positive : colors.warning} />
          <AppText variant="caption">Discipline {discipline}%</AppText>
          {!trade.journaled && trade.status === 'closed' ? <View style={styles.dot} accessibilityLabel="Journal pending" /> : null}
        </View>
      </View>
    </Card>
  );
}

export const TradeCard = memo(TradeCardBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  left: { gap: 4, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dir: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  right: { alignItems: 'flex-end', gap: 2 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  flex: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  thumb: { width: 28, height: 20, borderRadius: 4, backgroundColor: colors.surface },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});
