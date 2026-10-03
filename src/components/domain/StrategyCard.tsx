import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { Strategy } from '@/types/domain';
import { formatClock } from '@/utils/dates';

interface StrategyCardProps {
  strategy: Strategy;
  active?: boolean;
  onPress?: () => void;
}

export function StrategyCard({ strategy, active, onPress }: StrategyCardProps) {
  const window =
    strategy.entryWindowStart && strategy.entryWindowEnd
      ? `${formatClock(strategy.entryWindowStart)} – ${formatClock(strategy.entryWindowEnd)} ET`
      : 'Any time';
  return (
    <Card onPress={onPress} accessibilityLabel={`${strategy.name} strategy${active ? ', active' : ''}`}>
      <View style={styles.head}>
        <AppText variant="title" style={styles.flex} numberOfLines={1}>
          {strategy.name}
        </AppText>
        {active ? <StatusBadge label="Active" tone="accent" size="sm" /> : null}
      </View>
      <AppText variant="label" style={styles.meta}>
        {strategy.markets.join(' · ')} • {strategy.session || '—'}
      </AppText>
      <View style={styles.rows}>
        <AppText variant="body" tone="secondary">
          {window}
        </AppText>
        <AppText variant="body" tone="secondary">
          Minimum R:R 1:{strategy.minRR} · Max {strategy.maxTrades} trade{strategy.maxTrades > 1 ? 's' : ''}
        </AppText>
      </View>
      {onPress ? (
        <View style={styles.edit}>
          <AppText variant="label" tone="accent">
            Edit
          </AppText>
          <Ionicons name="arrow-forward" size={14} color={colors.accent} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  meta: { marginTop: spacing.sm },
  rows: { marginTop: spacing.md, gap: 4 },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: spacing.sm },
});
