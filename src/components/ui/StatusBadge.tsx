import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { radius, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

interface StatusBadgeProps {
  label: string;
  tone?: Tone;
  /** Icon reinforces meaning so status is not conveyed by color alone. */
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusBadge({ label, tone = 'neutral', icon, size = 'md' }: StatusBadgeProps) {
  const c = toneColor[tone];
  const fontSize = size === 'lg' ? 14 : size === 'sm' ? 10 : 11;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: c.bg }, size === 'lg' && styles.lg, size === 'sm' && styles.sm]}>
      {icon ? <Ionicons name={icon} size={fontSize + 3} color={c.fg} /> : <View style={[styles.dot, { backgroundColor: c.fg }]} />}
      <AppText variant="label" style={{ color: c.fg, fontSize }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  lg: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
