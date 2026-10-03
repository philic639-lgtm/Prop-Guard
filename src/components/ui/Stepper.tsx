import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
}

/** Whole-number stepper (contracts). */
export function Stepper({ value, onChange, min = 1, max = 99, label }: StepperProps) {
  const set = (v: number) => {
    const n = Math.max(min, Math.min(max, v));
    if (n !== value && Platform.OS !== 'web') void Haptics.selectionAsync();
    onChange(n);
  };
  return (
    <View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel={`${label} ${value}`}>
      <TextInput
        value={String(value)}
        onChangeText={(t) => {
          const n = parseInt(t.replace(/\D/g, ''), 10);
          if (!Number.isNaN(n)) set(n);
        }}
        keyboardType="number-pad"
        accessibilityLabel={label}
        style={styles.input}
        selectionColor={colors.accent}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => set(value - 1)} style={[styles.btn, styles.divider]} hitSlop={4}>
        <Ionicons name="remove" size={20} color={value <= min ? colors.textTertiary : colors.text} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => set(value + 1)} style={[styles.btn, styles.divider]} hitSlop={4}>
        <Ionicons name="add" size={20} color={value >= max ? colors.textTertiary : colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    height: 46,
    overflow: 'hidden',
  },
  input: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', paddingHorizontal: spacing.md, fontVariant: ['tabular-nums'] },
  btn: { width: 46, alignItems: 'center', justifyContent: 'center' },
  divider: { borderLeftWidth: 1, borderLeftColor: colors.border },
});
