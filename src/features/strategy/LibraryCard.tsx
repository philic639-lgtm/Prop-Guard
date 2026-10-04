import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import { CATEGORY_LABEL, CONDITION_LABEL, type Complexity, type StrategyCategory, type StrategyTemplate } from '@/data/strategyLibrary';
import { formatClock } from '@/utils/dates';

export const COMPLEXITY_TONE: Record<Complexity, Tone> = { Beginner: 'positive', Intermediate: 'warning', Advanced: 'danger' };

export const CATEGORY_ICON: Record<StrategyCategory, keyof typeof Ionicons.glyphMap> = {
  opening_range: 'time-outline',
  vwap: 'analytics-outline',
  trend: 'trending-up',
  breakout: 'arrow-up-circle-outline',
  support_resistance: 'reorder-two-outline',
  previous_day: 'calendar-outline',
  liquidity: 'swap-vertical',
  opening_session: 'flash-outline',
};

export function windowLabel(t: StrategyTemplate) {
  return t.defaults.entryWindowStart && t.defaults.entryWindowEnd
    ? `${formatClock(t.defaults.entryWindowStart)} – ${formatClock(t.defaults.entryWindowEnd)} ET`
    : 'Any liquid session';
}

interface LibraryCardProps {
  template: StrategyTemplate;
  locked?: boolean;
  saved?: boolean;
  /** Optional right-side badge such as a match %. */
  badge?: string;
}

/** Strategy library card: name, category, description, best-for, timeframe, instruments. */
function LibraryCardBase({ template: t, locked, saved, badge }: LibraryCardProps) {
  const open = () => router.push(locked ? '/paywall' : { pathname: '/strategy/library/[id]', params: { id: t.id } });
  const instruments = t.instruments.slice(0, 4).join(' • ') + (t.instruments.length > 4 ? ` +${t.instruments.length - 4}` : '');
  return (
    <Card onPress={open} accessibilityLabel={`${t.shortName}, ${CATEGORY_LABEL[t.category]}${locked ? ', Pro' : ''}`}>
      <View style={styles.head}>
        <View style={styles.libIcon}>
          <Ionicons name={CATEGORY_ICON[t.category]} size={18} color={colors.accentBright} />
        </View>
        <View style={styles.flex}>
          <AppText variant="heading" numberOfLines={1}>
            {t.shortName}
          </AppText>
          <AppText variant="label" style={{ fontSize: 10 }}>
            {CATEGORY_LABEL[t.category]}
          </AppText>
        </View>
        {locked ? (
          <Ionicons name="lock-closed" size={16} color={colors.textTertiary} />
        ) : badge ? (
          <StatusBadge label={badge} tone="accent" size="sm" />
        ) : saved ? (
          <StatusBadge label="Saved" tone="positive" icon="bookmark" size="sm" />
        ) : (
          <StatusBadge label={t.experienceLevel} tone={COMPLEXITY_TONE[t.experienceLevel]} size="sm" />
        )}
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.sm }} numberOfLines={2}>
        {t.description}
      </AppText>
      <View style={styles.meta}>
        <Meta label="Best for" value={t.marketConditions.slice(0, 2).map((c) => CONDITION_LABEL[c]).join(' / ')} />
        <Meta label="Typical" value={`${t.confirmationTimeframe.toUpperCase()} confirmation`} />
      </View>
      <View style={styles.foot}>
        <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.flex}>
          {instruments}
        </AppText>
        <Button label="View Strategy" size="md" variant="ghost" onPress={open} />
      </View>
    </Card>
  );
}

export const LibraryCard = memo(LibraryCardBase);

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ fontSize: 13 }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  libIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  metaItem: { flex: 1, gap: 2 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
