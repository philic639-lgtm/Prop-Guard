import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button } from '@/components/ui';
import { env } from '@/config/env';
import { DISCLAIMER } from '@/constants/legal';
import { colors, GUTTER, radius, spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { useAppStore } from '@/store/useAppStore';

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const loadDemo = useAppStore((s) => s.loadDemo);
  const user = useAppStore((s) => s.user);

  const start = () => {
    useOnboardingStore.getState().reset();
    if (env.supabaseConfigured && !user) router.push({ pathname: '/auth/sign-up', params: { next: 'onboarding' } });
    else router.push('/onboarding/markets');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
      <LinearGradient colors={['rgba(77,168,255,0.16)', 'rgba(9,11,15,0)']} style={styles.glow} pointerEvents="none" />
      <View style={styles.center}>
        <View style={styles.logo}>
          <Ionicons name="shield-checkmark" size={44} color={colors.accent} />
        </View>
        <AppText variant="label" tone="primary" style={styles.brand}>
          PROP GUARD
        </AppText>
        <AppText variant="display" align="center" style={styles.tagline}>
          Trade the plan.{'\n'}Protect the account.
        </AppText>
        <AppText variant="body" tone="secondary" align="center" style={styles.sub}>
          Your disciplined risk manager — before, during and after every session.
        </AppText>
      </View>
      <View style={styles.actions}>
        <Button label="Get started" onPress={start} />
        <Button
          label="Explore the demo"
          variant="secondary"
          icon="flask-outline"
          onPress={() => {
            loadDemo();
            router.replace('/home');
          }}
        />
        <View style={styles.signIn}>
          <AppText variant="caption">Already have an account?</AppText>
          <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }} onPress={() => router.push('/auth/sign-in')} accessibilityRole="link">
            Sign in
          </AppText>
        </View>
        <AppText variant="caption" tone="tertiary" align="center" style={styles.legal}>
          {DISCLAIMER}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: GUTTER },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  brand: { letterSpacing: 4, fontSize: 14 },
  tagline: { marginTop: spacing.sm, lineHeight: 40 },
  sub: { maxWidth: 300 },
  actions: { gap: spacing.sm },
  signIn: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  legal: { fontSize: 10, lineHeight: 14 },
});
