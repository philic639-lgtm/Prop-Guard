import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { Sheet } from './Sheet';

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | null;
  options: { value: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
  placeholder?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/** Dropdown-style select that opens a bottom sheet (instrument, setup type…). */
export function SelectField<T extends string>({ label, value, options, onChange, placeholder = 'Select', icon }: SelectFieldProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.8 }]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.textSecondary} /> : null}
        <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1} tone={current ? 'primary' : 'tertiary'}>
          {current?.label ?? placeholder}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={[styles.option, on && styles.optionOn]}>
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{o.label}</AppText>
                {o.sub ? <AppText variant="caption">{o.sub}</AppText> : null}
              </View>
              {on ? <Ionicons name="checkmark-circle" size={20} color={colors.accentBright} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  flex: { flex: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.accent },
});
