import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';
import { useActiveAccount, useDailyGuard } from '@/hooks/useAppData';
import type { NewsRisk } from '@/lib/engines/economicCalendar';
import { newsCushionAlert, type NewsCushionAlert } from '@/lib/engines/newsCushion';
import { useAppStore } from '@/store/useAppStore';

import { useEconomicCalendar } from './useEconomicCalendar';

/**
 * Compact warning for Home / Check Trade / Setup Check when a major scheduled release is
 * close. Guidance only — it never blocks a trade. Renders nothing when the calendar is clear.
 */
export function NewsRiskBanner({ risk, compact, cushion }: { risk: NewsRisk; compact?: boolean; cushion?: NewsCushionAlert | null }) {
  if (risk.state === 'clear') return null;
  const tone: Tone = cushion ? (cushion.level === 'danger' ? 'danger' : 'warning') : risk.state === 'in_window' && risk.impact === 'high' ? 'danger' : 'warning';
  const c = toneColor[tone];
  const label = risk.state === 'in_window' ? 'News window' : risk.state === 'approaching' ? 'Release coming up' : 'Release today';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${risk.headline}. ${cushion ? `${cushion.cushionLine} ` : ''}${risk.guidance[0] ?? ''} Open Intelligence.`}
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
        {cushion ? (
          <AppText variant="caption" numberOfLines={compact ? 2 : 3}>
            {cushion.cushionLine}
            {!compact && cushion.notes[0] ? ` ${cushion.notes[0]}` : ''}
          </AppText>
        ) : null}
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

/**
 * Self-contained: reads the cached calendar (refreshing it when old) and shows the banner when
 * relevant. With a configured backend, a stale or unavailable source is shown as such — a
 * failed refresh is never presented as "no upcoming news" (silence).
 */
export function NewsWatch({ compact }: { compact?: boolean }) {
  const { risk, freshness, connection, tradesIndexFutures, loading } = useEconomicCalendar();
  const account = useActiveAccount();
  const guard = useDailyGuard();
  const maxRisk = useAppStore((s) => s.tradingRules.maxRiskPerTrade);
  // The release combined with the SELECTED account's own cushion and the trader's risk limit.
  const cushion = newsCushionAlert(risk, guard, maxRisk, account?.name);
  if (risk.state !== 'clear') return <NewsRiskBanner risk={risk} compact={compact} cushion={cushion} />;
  if (connection === 'not_configured' || !tradesIndexFutures) return null;
  const notLive = freshness.perSource.filter((p) => p.connection !== 'connected');
  if (!notLive.length || (loading && connection === 'never')) return null;
  const unavailable = notLive.every((p) => p.connection === 'unavailable');
  const text = unavailable && notLive.length === freshness.perSource.length ? 'Economic calendar unavailable' : `News data ${notLive.some((p) => p.connection === 'unavailable') ? 'incomplete' : 'stale'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text}. Scheduled releases can't be confirmed. Open Intelligence.`}
      onPress={() => router.push('/intelligence')}
      style={({ pressed }) => [styles.wrap, { backgroundColor: toneColor.warning.bg, borderColor: toneColor.warning.fg + '55' }, pressed && { opacity: 0.85 }]}>
      <Icon name="alert-circle-outline" size={20} color={toneColor.warning.fg} />
      <View style={styles.text}>
        <AppText variant="caption" style={[styles.kicker, { color: toneColor.warning.fg }]}>
          {text.toUpperCase()}
        </AppText>
        <AppText variant={compact ? 'caption' : 'body'} numberOfLines={2}>
          Scheduled releases can’t be confirmed right now — check the official calendar before trading.
        </AppText>
      </View>
      <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}
