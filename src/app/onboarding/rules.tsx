import { router } from 'expo-router';
import { useState } from 'react';

import { finishOnboarding } from '@/features/onboarding/finishOnboarding';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStep } from '@/features/onboarding/steps';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { draftToRules, rulesToDraft, TradingRulesFields, type RulesDraft } from '@/features/rules/TradingRulesFields';

export default function RulesStep() {
  const rules = useOnboardingStore((s) => s.rules);
  const set = useOnboardingStore((s) => s.set);
  const path = useOnboardingStore((s) => s.profile.path);
  const beginner = useOnboardingStore((s) => s.profile.mode === 'beginner');
  const { step, total } = useOnboardingStep('rules');
  const [draft, setDraft] = useState<RulesDraft>(() => rulesToDraft(rules));
  const [errors, setErrors] = useState<Partial<Record<keyof RulesDraft, string>>>({});

  return (
    <OnboardingScaffold
      step={step}
      total={total}
      title="Confirm your trading rules"
      subtitle="These are YOUR rules. Prop Guard will hold you to them every session."
      cta={beginner ? 'Start learning' : path === 'build' ? 'Build my strategy' : 'Describe my strategy'}
      onNext={() => {
        const r = draftToRules(draft);
        setErrors(r.errors);
        if (!r.rules) return;
        set({ rules: r.rules });
        const chosen = finishOnboarding();
        router.dismissAll();
        router.replace('/home');
        router.push(beginner ? '/learn' : chosen === 'build' ? '/strategy/generating' : '/strategy/describe');
      }}
      secondary={{
        label: beginner ? 'Go to my dashboard' : "I'll set up a strategy later",
        onPress: () => {
          const r = draftToRules(draft);
          setErrors(r.errors);
          if (!r.rules) return;
          set({ rules: r.rules });
          finishOnboarding();
          router.dismissAll();
          router.replace('/home');
          if (!beginner) router.push('/start');
        },
      }}>
      <TradingRulesFields draft={draft} onChange={setDraft} errors={errors} />
    </OnboardingScaffold>
  );
}
