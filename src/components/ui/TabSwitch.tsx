import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface TabSwitchProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** Underlined top tabs: "Manual Entry | From Chart", "Today | Weekly | Insights". */
export function TabSwitch<T extends string>({ options, value, onChange }: TabSwitchProps<T>) {
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.tab, on && styles.on]}>
            <AppText variant="bodyStrong" style={{ fontSize: 14, color: on ? colors.text : colors.textSecondary }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingHorizontal: spacing.sm,
  },
  on: { backgroundColor: colors.accentMuted, borderBottomColor: colors.accent },
});
