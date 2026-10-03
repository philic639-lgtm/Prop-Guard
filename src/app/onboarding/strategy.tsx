import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { finishOnboarding } from '@/features/onboarding/finishOnboarding';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';

type Next = '/strategy/new' | '/strategy/library' | '/strategy/finder' | null;

const OPTIONS: { title: string; desc: string; icon: keyof typeof Ionicons.glyphMap; next: Next }[] = [
  { title: 'Build my strategy', desc: 'Define your entry, confirmation, stop and target rules.', icon: 'construct-outline', next: '/strategy/new' },
  { title: 'Import my strategy', desc: 'Already have written rules? Enter them in the builder.', icon: 'document-text-outline', next: '/strategy/new' },
  { title: 'Use strategy library', desc: 'Start from an educational template and customize it.', icon: 'library-outline', next: '/strategy/library' },
  { title: 'Help me find one', desc: 'Answer a few questions; we suggest structures that fit you.', icon: 'sparkles-outline', next: '/strategy/finder' },
];

export default function StrategyStep() {
  const go = (next: Next) => {
    finishOnboarding();
    router.dismissAll();
    router.replace('/home');
    if (next) router.push(next);
  };

  return (
    <OnboardingScaffold step={7} title="Choose strategy" subtitle="Prop Guard checks every trade against a strategy you define." cta="I'll do this later" onNext={() => go(null)}>
      {OPTIONS.map((o) => (
        <Card key={o.title} onPress={() => go(o.next)} accessibilityLabel={o.title}>
          <View style={styles.row}>
            <View style={styles.icon}>
              <Ionicons name={o.icon} size={20} color={colors.accent} />
            </View>
            <View style={styles.flex}>
              <AppText variant="heading">{o.title.toUpperCase()}</AppText>
              <AppText variant="caption">{o.desc}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </View>
        </Card>
      ))}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
});
