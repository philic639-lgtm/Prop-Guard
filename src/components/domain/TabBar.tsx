import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radius, TAB_BAR_HEIGHT } from '@/constants/theme';

/** The five primary destinations (other tab routes — analyze, performance — are reached from Home / More). */
export const TAB_ITEMS: Record<string, { icon: IconName; label: string }> = {
  home: { icon: 'dashboard', label: 'Home' },
  strategy: { icon: 'strategies', label: 'Strategies' },
  copy: { icon: 'copy-trade', label: 'Copy Trade' },
  journal: { icon: 'journal', label: 'Journal' },
  more: { icon: 'more', label: 'More' },
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route) => {
        const cfg = TAB_ITEMS[route.name];
        if (!cfg) return null;
        // Hidden routes (analyze, performance) light up their nearest home: Home.
        const focused = current === route.name || (route.name === 'home' && !TAB_ITEMS[current ?? '']);
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          if (current !== route.name && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            aria-selected={focused}
            accessibilityLabel={cfg.label}
            hitSlop={4}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.tab, hovered && !focused && styles.hovered, pressed && styles.pressed]}>
            <View style={[styles.pill, focused && styles.pillOn]}>
              <Icon name={cfg.icon} size={23} strokeWidth={focused ? 2.25 : 1.9} color={focused ? colors.accentBright : colors.textSecondary} />
            </View>
            <AppText variant="caption" numberOfLines={1} style={[styles.label, { color: focused ? colors.accentBright : colors.textSecondary }]}>
              {cfg.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: 'rgba(7, 12, 24, 0.98)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 4,
  },
  tab: { flex: 1, minWidth: 0, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 6 },
  pressed: { opacity: 0.7 },
  hovered: { opacity: 0.85 },
  pill: { width: 56, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.accentMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentBright + '40' },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
});
