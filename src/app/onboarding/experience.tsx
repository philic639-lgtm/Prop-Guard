import { router } from 'expo-router';

import { AppText, OptionCard } from '@/components/ui';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStep } from '@/features/onboarding/steps';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';

/** Beginner (guided learning path) or Experienced (straight to the tools). Switchable any time. */
export default function ExperienceStep() {
  const mode = useOnboardingStore((s) => s.profile.mode);
  const setProfile = useOnboardingStore((s) => s.setProfile);
  const { step, total } = useOnboardingStep('experience');
  return (
    <OnboardingScaffold
      step={step}
      total={total}
      title="How much prop trading experience do you have?"
      subtitle="Both experiences use the same account rules, risk checks, strategies and journal."
      cta="Continue"
      disabled={!mode}
      onNext={() => router.push(mode === 'beginner' ? '/onboarding/account' : '/onboarding/path')}>
      <OptionCard
        icon="school-outline"
        title="I’m new to prop trading"
        description="Step-by-step lessons on evaluations, drawdown and risk, a trading-personality check, strategy matches and your own trading plan."
        badge="Guided"
        selected={mode === 'beginner'}
        onPress={() => setProfile({ mode: 'beginner', path: 'build', experience: 'beginner' })}
      />
      <OptionCard
        icon="flash-outline"
        title="I’m an experienced trader"
        description="Skip the lessons: load your firm’s verified rules, import your strategy, test it, and go straight to the risk manager and dashboard."
        selected={mode === 'experienced'}
        onPress={() => setProfile({ mode: 'experienced', path: null, experience: 'intermediate' })}
      />
      <AppText variant="caption" tone="tertiary">
        You can switch any time in Profile — nothing is lost.
      </AppText>
    </OnboardingScaffold>
  );
}
