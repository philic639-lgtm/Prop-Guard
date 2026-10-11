import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ruleFor, SOURCE_LABEL, type EconomicEvent, type NewsRuleConfig } from '@/lib/engines/economicCalendar';

const ET_ZONE = 'America/New_York';

export function eventDay(e: EconomicEvent): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${e.dateET}T12:00:00Z`));
}

/** "8:30 AM ET" (+ the device's local time when it is not Eastern). */
export function eventTime(e: EconomicEvent): string {
  if (!e.startsAt) return 'Time not confirmed';
  const et = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET_ZONE }).format(new Date(e.startsAt));
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = deviceZone && deviceZone !== ET_ZONE ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(e.startsAt)) : null;
  return `${et} ET${local ? ` · ${local}` : ''}`;
}

/** One scheduled release: name, time, impact, time certainty and its official source. */
export function EventRow({ event, cfg }: { event: EconomicEvent; cfg: NewsRuleConfig }) {
  const rule = ruleFor(event.code, cfg);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${event.name}, ${eventDay(event)}, ${eventTime(event)}, ${rule.impact} impact`}>
      <View style={styles.when}>
        <AppText variant="caption" tone="tertiary">
          {eventDay(event)}
        </AppText>
        <AppText variant="bodyStrong" style={styles.num}>
          {event.startsAt ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET_ZONE }).format(new Date(event.startsAt)) : '—'}
        </AppText>
      </View>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{event.name}</AppText>
        <AppText variant="caption" tone="secondary">
          {eventTime(event)}
          {event.timeStatus === 'conventional' ? ' · usual time, confirm' : ''}
        </AppText>
        <View style={styles.badges}>
          <StatusBadge label={rule.impact === 'high' ? 'High impact' : rule.impact === 'medium' ? 'Medium' : 'Low'} tone={rule.impact === 'high' ? 'danger' : rule.impact === 'medium' ? 'warning' : 'neutral'} size="sm" />
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
