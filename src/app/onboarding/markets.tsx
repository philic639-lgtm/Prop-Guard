import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import type { InstrumentSymbol } from '@/types/domain';

const OPTIONS: (InstrumentSymbol | 'OTHER')[] = ['ES', 'MES', 'NQ', 'MNQ', 'OTHER'];

export default function Markets() {
  const markets = useOnboardingStore((s) => s.markets);
  const set = useOnboardingStore((s) => s.set);
  const toggle = (m: InstrumentSymbol | 'OTHER') => set({ markets: markets.includes(m) ? markets.filter((x) => x !== m) : [...markets, m] });

  return (
    <OnboardingScaffold step={2} title="What do you trade?" subtitle="Select all that apply." cta="Continue" disabled={markets.length === 0} onNext={() => router.push('/onboarding/trading-type')}>
      <View style={styles.grid}>
        {OPTIONS.map((m) => (
          <Chip key={m} large label={m === 'OTHER' ? 'Other' : m} selected={markets.includes(m)} onPress={() => toggle(m)} />
        ))}
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md } });
