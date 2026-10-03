import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { colors, radius, shadow, TAB_BAR_HEIGHT } from '@/constants/theme';

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap; label: string }> = {
  home: { on: 'grid', off: 'grid-outline', label: 'Home' },
  session: { on: 'shield-checkmark', off: 'shield-checkmark', label: 'Session' },
  strategy: { on: 'git-branch', off: 'git-branch-outline', label: 'Strategy' },
  journal: { on: 'book', off: 'book-outline', label: 'Journal' },
  profile: { on: 'person-circle', off: 'person-circle-outline', label: 'Profile' },
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const cfg = ICONS[route.name];
        if (!cfg) return null;
        const focused = state.index === index;
        const center = route.name === 'session';
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        if (center) {
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel="Session"
              style={styles.centerWrap}>
              <View style={[styles.center, focused && styles.centerFocused]}>
                <Ionicons name={cfg.on} size={26} color={colors.accentOn} />
              </View>
              <AppText variant="caption" style={[styles.label, { color: focused ? colors.text : colors.textSecondary }]}>
                {cfg.label}
              </AppText>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={cfg.label}
            style={styles.tab}>
            <Ionicons name={focused ? cfg.on : cfg.off} size={22} color={focused ? colors.accent : colors.textTertiary} />
            <AppText variant="caption" style={[styles.label, { color: focused ? colors.text : colors.textTertiary }]}>
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
    backgroundColor: 'rgba(12, 15, 20, 0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 },
  label: { fontSize: 11, fontWeight: '600' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, paddingBottom: 6 },
  center: {
    width: 56,
    height: 56,
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    borderWidth: 4,
    borderColor: colors.bg,
    ...shadow,
  },
  centerFocused: { backgroundColor: '#6AB8FF' },
});
