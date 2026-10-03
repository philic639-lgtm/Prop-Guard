import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useAppStore } from '@/store/useAppStore';

export function DemoBanner() {
  const mode = useAppStore((s) => s.mode);
  if (mode !== 'demo') return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Demo mode. Tap to set up your own account."
      onPress={() => router.push('/onboarding/welcome')}
      style={styles.banner}>
      <Ionicons name="flask-outline" size={14} color={colors.accent} />
      <AppText variant="caption" tone="accent" style={styles.text}>
        Demo data · Tap to set up your own account
      </AppText>
      <Ionicons name="chevron-forward" size={14} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentMuted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  text: { fontWeight: '600' },
});
