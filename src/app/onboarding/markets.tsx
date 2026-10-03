import { router } from 'expo-router';

import { ChoiceGrid, AppText } from '@/components/ui';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import type { InstrumentSymbol } from '@/types/domain';

const OPTIONS: { value: InstrumentSymbol | 'OTHER'; label: string; sub: string }[] = [
  { value: 'ES', label: 'ES', sub: 'E-mini S&P' },
  { value: 'MES', label: 'MES', sub: 'Micro S&P' },
  { value: 'NQ', label: 'NQ', sub: 'E-mini Nasdaq' },
  { value: 'MNQ', label: 'MNQ', sub: 'Micro Nasdaq' },
  { value: 'OTHER', label: 'Other', sub: 'Coming soon' },
];

export default function Markets() {
  const markets = useOnboardingStore((s) => s.markets);
  const set = useOnboardingStore((s) => s.set);

  return (
    <OnboardingScaffold step={1} title="What do you trade?" subtitle="Select every instrument you trade. Tap again to remove." cta="Continue" disabled={markets.filter((m) => m !== 'OTHER').length === 0} onNext={() => router.push('/onboarding/path')}>
      <ChoiceGrid
        label="Instruments"
        columns={2}
        options={OPTIONS}
        value={null}
        isSelected={(m) => markets.includes(m)}
        onChange={(m) => set({ markets: markets.includes(m) ? markets.filter((x) => x !== m) : [...markets, m] })}
      />
      <AppText variant="caption" tone="tertiary">
        Contract math (tick size, point value, micro/mini) is built in for ES, MES, NQ and MNQ.
      </AppText>
    </OnboardingScaffold>
  );
}
