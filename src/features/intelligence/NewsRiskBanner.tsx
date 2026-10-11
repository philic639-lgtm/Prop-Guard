import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';
import type { NewsRisk } from '@/lib/engines/economicCalendar';

import { useEconomicCalendar } from './useEconomicCalendar';

/**
 * Compact warning for Home / Check Trade / Setup Check when a major scheduled release is
 * close. Guidance only — it never blocks a trade. Renders nothing when the calendar is clear.
 */
export function NewsRiskBanner({ risk, compact }: { risk: NewsRisk; compact?: boolean }) {
  if (risk.state === 'clear') return null;
  const tone: Tone = risk.state === 'in_window' && risk.impact === 'high' ? 'danger' : 'warning';
  const c = toneColor[tone];
  const label = risk.state === 'in_window' ? 'News window' : risk.state === 'approaching' ? 'Release coming up' : 'Release today';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${risk.headline}. ${risk.guidance[0] ?? ''} Open Intelligence.`}
      onPress={() => router.push('/intelligence')}
      style={({ pressed }) => [styles.wrap, { backgroundColor: c.bg, borderColor: c.fg + '55' }, pressed && { opacity: 0.85 }]}>
      <Icon name="economic-calendar" size={20} color={c.fg} />
      <View style={styles.text}>
        <AppText variant="caption" style={[styles.kicker, { color: c.fg }]}>
          {label.toUpperCase()}
        </AppText>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {risk.headline}
        </AppText>
        {!compact && risk.guidance[0] ? (
          <AppText variant="caption" tone="secondary" numberOfLines={2}>
            {risk.guidance[0]}
          </AppText>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontWeight: '700', letterSpacing: 0.6, fontSize: 11 },
});

/** Self-contained: reads the cached calendar (refreshing it when old) and shows the banner when relevant. */
export function NewsWatch({ compact }: { compact?: boolean }) {
  const { risk } = useEconomicCalendar();
  return <NewsRiskBanner risk={risk} compact={compact} />;
}
