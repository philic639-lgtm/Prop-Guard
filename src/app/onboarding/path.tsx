import { router } from 'expo-router';

import { OptionCard } from '@/components/ui';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStep } from '@/features/onboarding/steps';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';

export default function ChoosePath() {
  const path = useOnboardingStore((s) => s.profile.path);
  const setProfile = useOnboardingStore((s) => s.setProfile);
  const { step, total } = useOnboardingStep('path');
  return (
    <OnboardingScaffold step={step} total={total} title="How do you want to start?" subtitle="Prop Guard checks every trade against a plan. Bring yours, or build one." cta="Continue" disabled={!path} onNext={() => router.push('/onboarding/account')}>
      <OptionCard
        icon="shield-checkmark-outline"
        title="I have a strategy"
        description="Teach Prop Guard the plan you already trade. Describe it in plain English."
        selected={path === 'have_strategy'}
        onPress={() => setProfile({ path: 'have_strategy' })}
      />
      <OptionCard
        icon="sparkles"
        title="Help me build a strategy"
        description="Create a structured, repeatable plan based on your account, risk limits and preferences."
        selected={path === 'build'}
        onPress={() => setProfile({ path: 'build' })}
      />
    </OnboardingScaffold>
  );
}
