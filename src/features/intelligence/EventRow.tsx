import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ET, formatClock, formatDay, ruleFor, SOURCE_LABEL, validZone, type EconomicEvent, type NewsRuleConfig } from '@/lib/engines/economicCalendar';

/** Release day: in the trader's zone when the time is known (an evening ET release can be the next day in Asia), else the official ET date. */
export function eventDay(e: EconomicEvent, zone?: string): string {
  if (e.startsAt) return formatDay(e.startsAt, zone ?? ET);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${e.dateET}T12:00:00Z`));
}

/** "5:30 AM PST · 8:30 AM EST" — the trader's zone first, Eastern (the official time) when different; DST-aware. */
export function eventTime(e: EconomicEvent, zone?: string): string {
  if (!e.startsAt) return 'Time not confirmed';
  const z = validZone(zone) ?? ET;
  return z === ET ? formatClock(e.startsAt, ET) : `${formatClock(e.startsAt, z)} · ${formatClock(e.startsAt, ET)}`;
}

const IMPACT_LABEL = { high: 'High impact', medium: 'Medium impact', low: 'Low impact' } as const;

/** One scheduled release: name, time, Prop Guard's impact rating, time certainty and its official source. */
export function EventRow({ event, cfg, zone }: { event: EconomicEvent; cfg: NewsRuleConfig; zone?: string }) {
  const rule = ruleFor(event.code, cfg);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${event.name}, ${eventDay(event, zone)}, ${eventTime(event, zone)}, ${IMPACT_LABEL[rule.impact]} by Prop Guard's classification`}>
      <View style={styles.when}>
        <AppText variant="caption" tone="tertiary">
          {eventDay(event, zone)}
        </AppText>
        <AppText variant="bodyStrong" style={styles.num}>
          {event.startsAt ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: validZone(zone) ?? ET }).format(new Date(event.startsAt)) : '—'}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{event.name}</AppText>
        <AppText variant="caption" tone="secondary">
          {eventTime(event, zone)}
          {event.timeStatus === 'conventional' ? ' · usual time, confirm' : ''}
        </AppText>
        <View style={styles.badges}>
          <StatusBadge label={`${IMPACT_LABEL[rule.impact]} · Prop Guard`} tone={rule.impact === 'high' ? 'danger' : rule.impact === 'medium' ? 'warning' : 'neutral'} size="sm" />
          <Pressable accessibilityRole="link" accessibilityLabel={`Open the ${SOURCE_LABEL[event.source]} calendar`} onPress={() => void Linking.openURL(event.sourceUrl)} hitSlop={6}>
            <AppText variant="caption" tone="accent">
              {SOURCE_LABEL[event.source]} ↗
            </AppText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  when: { width: 72, gap: 2 },
  num: { fontVariant: ['tabular-nums'] },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 2 },
});
