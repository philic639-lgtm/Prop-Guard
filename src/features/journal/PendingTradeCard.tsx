import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { PendingTrade } from '@/types/domain';
import { money, price, rr, shortDate, time } from '@/utils/format';

interface PendingTradeCardProps {
  pending: PendingTrade;
  strategyName?: string | null;
  onPress: () => void;
}

/** A checked trade waiting for its result. One tap to complete the journal entry. */
function PendingTradeCardBase({ pending: p, strategyName, onPress }: PendingTradeCardProps) {
  const long = p.direction === 'long';
  return (
    <Card onPress={onPress} accessibilityLabel={`Pending ${p.instrument} ${p.direction}, add result`}>
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.titleRow}>
            <AppText variant="heading">{p.instrument}</AppText>
            <View style={[styles.dir, { backgroundColor: long ? colors.positiveMuted : colors.dangerMuted }]}>
              <Ionicons name={long ? 'arrow-up' : 'arrow-down'} size={12} color={long ? colors.positive : colors.danger} />
              <AppText variant="label" style={{ fontSize: 10, color: long ? colors.positive : colors.danger }}>
                {p.direction}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" tone="tertiary">
            {shortDate(p.createdAt)} · {time(p.createdAt)} · {p.contracts} ct · {p.origin === 'calculator' ? 'Risk Calculator' : 'Trade check'}
          </AppText>
        </View>
        <StatusBadge label="Pending" tone="warning" icon="time-outline" size="sm" />
      </View>
      <AppText variant="caption" style={styles.levels}>
        Entry {price(p.entry, p.instrument)} · Stop {price(p.stop, p.instrument)} · Target {price(p.target, p.instrument)}
      </AppText>
      <View style={styles.footer}>
        <AppText variant="caption" numberOfLines={1} style={styles.flex}>
          {money(p.riskDollars)} risk · {rr(p.rr)} · {strategyName ?? 'No strategy'}
        </AppText>
        <Button label="Add result" size="md" variant="secondary" onPress={onPress} />
      </View>
    </Card>
  );
}

export const PendingTradeCard = memo(PendingTradeCardBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  left: { gap: 4, flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dir: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  levels: { marginTop: spacing.sm },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  flex: { flex: 1 },
});
