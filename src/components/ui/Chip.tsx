import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  large?: boolean;
}

export function Chip({ label, selected, onPress, icon, large }: ChipProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'checkbox' : undefined}
      accessibilityState={{ checked: !!selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, large && styles.large, selected && styles.selected, pressed && { opacity: 0.8 }]}>
      {selected ? <Ionicons name="checkmark" size={14} color={colors.accent} /> : icon ? <Ionicons name={icon} size={14} color={colors.textSecondary} /> : null}
      <AppText variant="bodyStrong" style={{ color: selected ? colors.accent : colors.textSecondary, fontSize: large ? 16 : 14 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  large: { minHeight: 52, paddingHorizontal: spacing.xl },
  selected: { backgroundColor: colors.accentMuted, borderColor: colors.accent + '88' },
});
