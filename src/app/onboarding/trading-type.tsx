import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import type { TradingType } from '@/types/domain';

const OPTIONS: { value: TradingType; title: string; desc: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'prop', title: 'Prop firm', desc: 'Evaluations and funded accounts with firm rules.', icon: 'business-outline' },
  { value: 'personal', title: 'Personal account', desc: 'Your own capital with your own limits.', icon: 'wallet-outline' },
  { value: 'both', title: 'Both', desc: 'Prop accounts and a personal account.', icon: 'layers-outline' },
];

export default function TradingTypeScreen() {
  const type = useOnboardingStore((s) => s.tradingType);
  const set = useOnboardingStore((s) => s.set);
  return (
    <OnboardingScaffold
      step={3}
      title="How do you trade?"
      cta="Continue"
      onNext={() => router.push(type === 'personal' ? '/onboarding/account' : '/onboarding/prop-firm')}>
      {OPTIONS.map((o) => {
        const selected = type === o.value;
        return (
          <Card key={o.value} onPress={() => set({ tradingType: o.value })} tone={selected ? 'accent' : undefined} accessibilityLabel={o.title}>
            <View style={styles.row}>
              <Ionicons name={o.icon} size={22} color={selected ? colors.accent : colors.textSecondary} />
              <View style={styles.flex}>
                <AppText variant="heading">{o.title}</AppText>
                <AppText variant="caption">{o.desc}</AppText>
              </View>
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.accent : colors.textTertiary} />
            </View>
          </Card>
        );
      })}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, flex: { flex: 1, gap: 2 } });
