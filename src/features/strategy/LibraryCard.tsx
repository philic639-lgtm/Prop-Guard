import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import type { Complexity, LibraryTemplate } from '@/data/strategyLibrary';
import { formatClock } from '@/utils/dates';

const COMPLEXITY_TONE: Record<Complexity, Tone> = { Beginner: 'positive', Intermediate: 'warning', Advanced: 'danger' };
const STYLE_LABEL: Record<LibraryTemplate['style'], string> = { breakout: 'Breakout', pullback: 'Pullback', reversal: 'Reversal', trend: 'Trend' };

export function windowLabel(t: LibraryTemplate) {
  return t.defaults.entryWindowStart && t.defaults.entryWindowEnd
    ? `${formatClock(t.defaults.entryWindowStart)} – ${formatClock(t.defaults.entryWindowEnd)} ET`
    : 'Any liquid session';
}

/** Library template card: difficulty, style, typical window, description. */
export function LibraryCard({ template: t, locked }: { template: LibraryTemplate; locked?: boolean }) {
  return (
    <Card onPress={() => router.push(locked ? '/paywall' : { pathname: '/strategy/library/[id]', params: { id: t.id } })} accessibilityLabel={`${t.name}, ${t.complexity}${locked ? ', Pro' : ''}`}>
      <View style={styles.head}>
        <View style={styles.libIcon}>
          <Ionicons name={t.style === 'breakout' ? 'trending-up' : t.style === 'pullback' ? 'git-pull-request' : t.style === 'reversal' ? 'swap-vertical' : 'navigate'} size={18} color={colors.accentBright} />
        </View>
        <AppText variant="heading" style={styles.flex} numberOfLines={1}>
          {t.name}
        </AppText>
        {locked ? <Ionicons name="lock-closed" size={16} color={colors.textTertiary} /> : <StatusBadge label={t.complexity} tone={COMPLEXITY_TONE[t.complexity]} size="sm" />}
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.sm }} numberOfLines={2}>
        {t.summary}
      </AppText>
      <View style={styles.tags}>
        <Tag icon="pulse-outline" label={STYLE_LABEL[t.style]} />
        <Tag icon="time-outline" label={windowLabel(t)} />
        <Tag icon="layers-outline" label={t.timeframes.split(' · ')[0]} />
      </View>
    </Card>
  );
}

function Tag({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.tag}>
      <Ionicons name={icon} size={12} color={colors.textSecondary} />
      <AppText variant="caption" style={{ fontSize: 11.5 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  libIcon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
});
