import { router } from 'expo-router';
import { useState } from 'react';

import { AppHeader, AppText, Button, Screen } from '@/components/ui';
import { draftToRules, rulesToDraft, TradingRulesFields, type RulesDraft } from '@/features/rules/TradingRulesFields';
import { useAppStore } from '@/store/useAppStore';

export default function RulesSettings() {
  const rules = useAppStore((s) => s.tradingRules);
  const setRules = useAppStore((s) => s.setTradingRules);
  const [draft, setDraft] = useState<RulesDraft>(() => rulesToDraft(rules));
  const [errors, setErrors] = useState<Partial<Record<keyof RulesDraft, string>>>({});

  const save = () => {
    const r = draftToRules(draft);
    setErrors(r.errors);
    if (!r.rules) return;
    setRules(r.rules);
    router.back();
  };

  return (
    <Screen header={<AppHeader title="Trading rules" back />} footer={<Button label="Save rules" icon="checkmark" onPress={save} />}>
      <AppText variant="caption">
        These personal rules apply on top of every account&apos;s limits. The tighter limit always wins.
      </AppText>
      <TradingRulesFields draft={draft} onChange={setDraft} errors={errors} />
    </Screen>
  );
}
