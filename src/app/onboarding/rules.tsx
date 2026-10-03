import { router } from 'expo-router';
import { useState } from 'react';

import { draftToRules, rulesToDraft, TradingRulesFields, type RulesDraft } from '@/features/rules/TradingRulesFields';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';

export default function RulesStep() {
  const rules = useOnboardingStore((s) => s.rules);
  const set = useOnboardingStore((s) => s.set);
  const [draft, setDraft] = useState<RulesDraft>(() => rulesToDraft(rules));
  const [errors, setErrors] = useState<Partial<Record<keyof RulesDraft, string>>>({});

  return (
    <OnboardingScaffold
      step={6}
      title="Create your trading rules"
      subtitle="These are YOUR rules. Prop Guard will hold you to them every session."
      cta="Continue"
      onNext={() => {
        const r = draftToRules(draft);
        setErrors(r.errors);
        if (!r.rules) return;
        set({ rules: r.rules });
        router.push('/onboarding/strategy');
      }}>
      <TradingRulesFields draft={draft} onChange={setDraft} errors={errors} />
    </OnboardingScaffold>
  );
}
