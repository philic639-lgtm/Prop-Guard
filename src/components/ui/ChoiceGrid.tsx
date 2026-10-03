import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface ChoiceGridProps<T extends string> {
  label?: string;
  options: { value: T; label: string; sub?: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: number;
}

/** Grid of square-ish selectable buttons ($10K / $25K / $50K, Scalp / Intraday / Swing). */
export function ChoiceGrid<T extends string>({ label, options, value, onChange, columns = 3 }: ChoiceGridProps<T>) {
  return (
    <View style={styles.wrap}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={o.label}
              onPress={() => {
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
                onChange(o.value);
              }}
              style={[styles.cell, { flexBasis: `${100 / columns - 4}%` }, on && styles.on]}>
              <AppText variant="bodyStrong" style={{ fontSize: 14, color: on ? colors.text : colors.textSecondary }} align="center">
                {o.label}
              </AppText>
              {o.sub ? (
                <AppText variant="caption" tone="tertiary" align="center" style={{ fontSize: 11 }}>
                  {o.sub}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    flexGrow: 1,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { borderColor: colors.accent, backgroundColor: '#0D1B33' },
});
