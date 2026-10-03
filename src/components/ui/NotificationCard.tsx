import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import type { AlertKind } from '@/types/domain';

import { AppText } from './AppText';

const KIND_UI: Record<AlertKind, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  good_entry: { icon: 'checkmark-circle', color: colors.positive },
  move_stop_breakeven: { icon: 'arrow-up-circle', color: colors.warning },
  partial_taken: { icon: 'pie-chart', color: colors.positive },
  take_profit: { icon: 'flag', color: colors.positive },
  approaching_stop: { icon: 'warning', color: colors.danger },
  trade_closed: { icon: 'checkmark-done-circle', color: colors.positive },
  risk_limit: { icon: 'alert-circle', color: colors.danger },
  cooldown: { icon: 'timer', color: colors.warning },
};

interface NotificationCardProps {
  kind: AlertKind;
  title: string;
  body: string;
  time?: string;
  unread?: boolean;
  onPress?: () => void;
  highlight?: boolean;
}

/** Push-notification style card used in the alert feed and as in-app toasts. */
export function NotificationCard({ kind, title, body, time, unread, onPress, highlight }: NotificationCardProps) {
  const ui = KIND_UI[kind];
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}. ${body}${time ? `. ${time}` : ''}`}
      style={[styles.card, highlight && { borderColor: ui.color + '99' }]}>
      <View style={styles.logo}>
        <Ionicons name="shield-checkmark" size={22} color={colors.positive} />
      </View>
      <View style={styles.text}>
        <View style={styles.head}>
          <AppText variant="caption" tone="secondary" style={styles.app}>
            PropGuard
          </AppText>
          {time ? (
            <AppText variant="caption" tone="tertiary">
              {time}
            </AppText>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <AppText variant="bodyStrong">{title}</AppText>
          <Ionicons name={ui.icon} size={15} color={ui.color} />
          {unread ? <View style={styles.dot} /> : null}
        </View>
        <AppText variant="caption" tone="primary" style={{ opacity: 0.85 }}>
          {body}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(22, 32, 52, 0.96)',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  app: { fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent, marginLeft: 'auto' },
});
