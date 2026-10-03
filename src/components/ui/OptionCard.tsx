import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface OptionCardProps {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  onPress: () => void;
  badge?: string;
  disabled?: boolean;
}

/** Large selectable card (choose path, connection method, practice-or-use). */
export function OptionCard({ title, description, icon, selected, onPress, badge, disabled }: OptionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={`${title}${badge ? `, ${badge}` : ''}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.selected, disabled && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
      {icon ? (
        <View style={[styles.icon, selected && { backgroundColor: colors.accent + '33' }]}>
          <Ionicons name={icon} size={24} color={selected ? colors.accentBright : colors.textSecondary} />
        </View>
      ) : null}
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="heading" style={styles.title}>
            {title}
          </AppText>
          {badge ? (
            <View style={styles.badge}>
              <AppText variant="label" style={{ fontSize: 9, color: colors.accentBright }}>
                {badge}
              </AppText>
            </View>
          ) : null}
        </View>
        {description ? <AppText variant="caption">{description}</AppText> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={selected ? colors.accentBright : colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.accent, backgroundColor: '#0D1B33' },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  title: { textTransform: 'uppercase', fontSize: 15, letterSpacing: 0.4 },
  badge: { backgroundColor: colors.accentMuted, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
});
