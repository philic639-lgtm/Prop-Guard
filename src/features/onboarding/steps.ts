import type { ExperienceMode } from '@/types/domain';

import { useOnboardingStore } from './useOnboardingStore';

export type OnboardingStepId = 'markets' | 'experience' | 'path' | 'account' | 'preferences' | 'rules';

/** Beginners skip "How do you want to start?" — the learning path builds their plan. */
export function onboardingSteps(mode: ExperienceMode | undefined): OnboardingStepId[] {
  return mode === 'beginner'
    ? ['markets', 'experience', 'account', 'preferences', 'rules']
    : ['markets', 'experience', 'path', 'account', 'preferences', 'rules'];
}

/** Step number + total for the progress header, following the chosen experience. */
export function useOnboardingStep(id: OnboardingStepId): { step: number; total: number } {
  const mode = useOnboardingStore((s) => s.profile.mode);
  const steps = onboardingSteps(mode);
  return { step: steps.indexOf(id) + 1, total: steps.length };
}
