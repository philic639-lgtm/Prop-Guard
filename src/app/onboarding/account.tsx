import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { NumericInput } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { AccountFields } from '@/features/accounts/AccountFields';
import { accountSchema, accountToForm, formToAccount, type AccountFormValues } from '@/features/accounts/accountSchema';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

export default function AccountStep() {
  const o = useOnboardingStore();
  const firm = o.propFirm && o.propFirm !== 'Manual rules' && o.propFirm !== 'Other' ? o.propFirm : '';
  const { control, handleSubmit } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: accountToForm(o.account, {
      name: firm ? `${firm} 25K` : o.tradingType === 'personal' ? 'Personal account' : '',
      firm,
      kind: o.tradingType === 'personal' ? 'personal' : 'prop',
    }),
    mode: 'onBlur',
  });
  const [maxTrades, setMaxTrades] = useState(String(o.rules.maxTradesPerDay));
  const [riskPerTrade, setRiskPerTrade] = useState(String(o.rules.maxRiskPerTrade));

  const next = handleSubmit((v) => {
    const account = formToAccount(v, null, o.account?.id ?? uuid());
    const daily = account.rules.dailyLossLimit;
    o.set({
      account,
      rules: {
        ...o.rules,
        maxTradesPerDay: Math.max(1, Math.round(parseNum(maxTrades) ?? o.rules.maxTradesPerDay)),
        maxRiskPerTrade: parseNum(riskPerTrade) ?? o.rules.maxRiskPerTrade,
        dailyStop: daily ? Math.min(o.rules.dailyStop, daily) : o.rules.dailyStop,
      },
    });
    router.push('/onboarding/rules');
  });

  return (
    <OnboardingScaffold step={5} title="Create account" subtitle="Daily Guard uses these numbers to keep you inside your limits." cta="Continue" onNext={next}>
      <AccountFields control={control} />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Max trades / day" value={maxTrades} onChangeText={setMaxTrades} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Preferred risk / trade" prefix="$" value={riskPerTrade} onChangeText={setRiskPerTrade} />
        </View>
      </View>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.md }, flex: { flex: 1 } });
