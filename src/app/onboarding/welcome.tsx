import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Logo } from '@/components/ui';
import { env } from '@/config/env';
import { DISCLAIMER } from '@/constants/legal';
import { colors, GUTTER, radius, spacing } from '@/constants/theme';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { useAppStore } from '@/store/useAppStore';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }[] = [
  { icon: 'shield-checkmark', color: colors.accentBright, text: 'Load your firm’s verified rules and protect the account' },
  { icon: 'calculator', color: colors.positive, text: 'Plan every trade: size, risk and rules checked before entry' },
  { icon: 'school', color: colors.warning, text: 'Learn step by step — or skip straight to your tools' },
  { icon: 'trending-up', color: colors.positive, text: 'Practice, journal and improve your own strategy' },
];

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
      <LinearGradient colors={['rgba(31,123,255,0.20)', 'rgba(6,10,19,0)']} style={styles.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Logo size="xl" />
          <AppText variant="body" tone="secondary" align="center">
            Risk management, planning and strategy coaching for prop firm traders
          </AppText>
          <AppText variant="display" align="center" style={styles.tagline}>
            PLAN YOUR{' '}
            <AppText variant="display" style={{ color: colors.positive }}>
              TRADE.
            </AppText>
          </AppText>
        </View>
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.text} style={styles.feature}>
              <View style={[styles.featureIcon, { backgroundColor: f.color + '22' }]}>
                <Ionicons name={f.icon} size={20} color={f.color} />
              </View>
              <AppText variant="body" style={{ flex: 1 }}>
                {f.text}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Get Started" variant="success" onPress={start} />
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
            Sign In
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
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },
  scroll: { flexGrow: 1, justifyContent: 'center', gap: spacing.xxl, paddingVertical: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.md },
  tagline: { marginTop: spacing.sm, lineHeight: 40 },
  features: { gap: spacing.md },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing.sm },
  signIn: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.xs },
  legal: { fontSize: 10, lineHeight: 14 },
});
