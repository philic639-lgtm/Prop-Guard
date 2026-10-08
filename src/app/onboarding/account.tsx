import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, ChoiceGrid, NumericInput, OptionCard, SectionHeader, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { AccountFields } from '@/features/accounts/AccountFields';
import { accountSchema, accountToForm, formToAccount, ruleValuesOf, type AccountFormValues } from '@/features/accounts/accountSchema';
import { FirmAutocomplete, FirmRulesStatus, ProgramPicker } from '@/features/accounts/FirmRulePicker';
import { useFirmRuleLink } from '@/features/accounts/useFirmRuleLink';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStep } from '@/features/onboarding/steps';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import { detectOverrides } from '@/lib/engines';
import { calcAfterOverrides, validateFirmConfiguration, type ConfigIssue } from '@/lib/engines/firmRulesEngine';
import type { ConnectionMethod, CustomRule } from '@/types/domain';
import { money, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

/**
 * Account & risk setup. Firm → program → stage → size loads the VERIFIED
 * rules (same loader as Accounts → New). Nothing is assumed: an unverified
 * firm, or a blank field, stays blank until the trader enters it.
 */
const BLANK_RULES: Partial<AccountFormValues> = { size: '', balance: '', profitTarget: '', maxDrawdown: '', dailyLossLimit: '' };

export default function AccountStep() {
  const o = useOnboardingStore();
  const imported = o.imported;
  const { step, total } = useOnboardingStep('account');

  const { control, handleSubmit, setValue, getValues } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: o.account ? accountToForm(o.account) : accountToForm(null, { ...BLANK_RULES, balance: imported?.balance != null ? String(imported.balance) : '' }),
    mode: 'onBlur',
  });
  const [custom, setCustom] = useState<CustomRule[]>(o.account?.rules.custom ?? []);
  const firmRules = useFirmRuleLink({ existing: o.account, setValue, getValues, setCustom });
  const { link } = firmRules;
  const firmText = useWatch({ control, name: 'firm' });
  const values = useWatch({ control }) as AccountFormValues;
  const overrides = useMemo(() => (link ? detectOverrides(link.imported, ruleValuesOf(values)) : []), [link, values]);
  const [overriding, setOverriding] = useState(() => (o.account?.firmLink?.overrides.length ?? 0) > 0);
  const locked = link?.status === 'verified' && !overriding;
  const toggleLock = () => {
    if (!link) return;
    if (overriding) for (const [k, v] of Object.entries(link.imported)) firmRules.restore(k as keyof typeof link.imported, v);
    setOverriding((x) => !x);
  };

  const [riskPerTrade, setRiskPerTrade] = useState(String(o.rules.maxRiskPerTrade === 150 ? 100 : o.rules.maxRiskPerTrade));
  const [dailyLoss, setDailyLoss] = useState(String(o.rules.dailyStop === 400 ? 200 : o.rules.dailyStop));
  const [maxTrades, setMaxTrades] = useState<string>(o.rules.maxTradesPerDay > 3 ? 'custom' : String(Math.min(o.rules.maxTradesPerDay, 2)));
  const [customTrades, setCustomTrades] = useState('4');
  const [ddRemaining, setDdRemaining] = useState(imported?.drawdownRemaining != null ? String(imported.drawdownRemaining) : '');
  const [riskErrors, setRiskErrors] = useState<{ risk?: string; daily?: string }>({});
  const [issues, setIssues] = useState<ConfigIssue[]>([]);

  // Apply confirmed screenshot values when the trader returns from the import screen.
  const [seenImport, setSeenImport] = useState(imported);
  if (imported !== seenImport) {
    setSeenImport(imported);
    if (imported?.balance != null) setValue('balance', String(imported.balance));
    if (imported?.drawdownRemaining != null) setDdRemaining(String(imported.drawdownRemaining));
  }

  const connection = o.profile.connection;
  const accountDll = parseNum(values.dailyLossLimit);

  const validateRisk = () => {
    const risk = parseNum(riskPerTrade);
    const daily = parseNum(dailyLoss);
    const errs: typeof riskErrors = {};
    if (!risk || risk <= 0) errs.risk = 'Enter your max risk per trade';
    else if (daily && risk > daily) errs.risk = 'Cannot exceed your max daily loss';
    if (!daily || daily <= 0) errs.daily = 'Enter your max daily loss';
    else if (accountDll && daily > accountDll) errs.daily = `Above the account’s daily loss limit (${money(accountDll)})`;
    setRiskErrors(errs);
    return Object.keys(errs).length ? null : { risk: risk!, daily: daily! };
  };

  const submit = handleSubmit(
    (v) => {
      const limits = validateRisk();
      const problems = validateFirmConfiguration(firmRules.db, link, { size: v.size }, new Date().toISOString());
      setIssues(problems);
      if (!limits || problems.length) return;
      const firmLink = link && (link.firmId || v.firm.trim()) ? { ...link, overrides: detectOverrides(link.imported, ruleValuesOf(v)) } : undefined;
      const account = formToAccount(v, null, o.account?.id ?? uuid(), parseNum(ddRemaining), firmLink);
      account.rules.custom = custom;
      const calc = firmLink?.status === 'verified' ? calcAfterOverrides(firmLink.calc, firmLink.overrides, v.dailyLossLimit) : undefined;
      if (calc) account.rules.calc = calc;
      else delete account.rules.calc;
      const trades = maxTrades === 'custom' ? Math.max(1, Math.round(parseNum(customTrades) ?? 3)) : Number(maxTrades);
      o.set({
        account,
        propFirm: v.kind === 'personal' ? 'Personal' : v.firm.trim(),
        tradingType: v.kind === 'personal' ? 'personal' : 'prop',
        rules: { ...o.rules, maxRiskPerTrade: limits.risk, dailyStop: limits.daily, maxTradesPerDay: trades },
      });
      router.push('/onboarding/preferences');
    },
    () => validateRisk(),
  );

  // A blank balance means "same as the account size" (a new account starts at its size).
  const next = () => {
    if (!getValues('balance').trim() && getValues('size').trim()) setValue('balance', getValues('size'));
    void submit();
  };

  const chooseConnection = (c: ConnectionMethod) => {
    o.setProfile({ connection: c });
    if (c === 'screenshot') router.push('/onboarding/connect');
  };

  return (
    <OnboardingScaffold step={step} total={total} title="Let's set up your account" subtitle="Pick your firm and program — verified rules load automatically." cta="Continue" onNext={next}>
      <SectionHeader title="How should Prop Guard get your account data?" />
      <OptionCard icon="link" title="Connect trading account" description="Tradovate, NinjaTrader, Rithmic, ProjectX" badge="Coming soon" disabled onPress={() => undefined} />
      <OptionCard icon="camera-outline" title="Import from screenshot" description="Upload your dashboard. AI reads balance & drawdown." selected={connection === 'screenshot'} onPress={() => chooseConnection('screenshot')} />
      <OptionCard icon="create-outline" title="Enter manually" description="Add your account details yourself. Works with any platform." selected={connection === 'manual'} onPress={() => chooseConnection('manual')} />
      {imported ? (
        <Card tone="positive">
          <StatusBadge label="Imported from screenshot" tone="positive" icon="checkmark-circle" size="sm" />
          <AppText variant="caption" style={{ marginTop: spacing.sm }}>
            Balance {money(imported.balance)} · Drawdown remaining {money(imported.drawdownRemaining)} — confirmed by you.
          </AppText>
        </Card>
      ) : null}

      <SectionHeader title="Your account" />
      <AccountFields
        control={control}
        imported={link?.status === 'verified' ? link.imported : undefined}
        onRestore={firmRules.restore}
        locked={locked}
        onToggleLock={link?.status === 'verified' ? toggleLock : undefined}
        firmSlot={
          <>
            <FirmAutocomplete db={firmRules.db} value={firmText ?? ''} selected={firmRules.firm} onChangeText={firmRules.changeFirmText} onSelectFirm={firmRules.selectFirm} />
            {firmRules.firm ? (
              <ProgramPicker
                key={firmRules.firm.id}
                db={firmRules.db}
                firm={firmRules.firm}
                link={link}
                familyKey={firmRules.familyKey}
                options={firmRules.options}
                purchasedOn={firmRules.purchasedOn}
                onSelectFamily={firmRules.selectFamily}
                onSelectProgram={firmRules.selectProgram}
                onSelectOption={firmRules.selectOption}
                onChangePurchasedOn={firmRules.changePurchasedOn}
                onCustomProgram={firmRules.customProgram}
              />
            ) : null}
          </>
        }
        rulesFooter={<FirmRulesStatus db={firmRules.db} link={link} overrides={overrides} firmName={firmRules.firm?.name ?? firmText ?? ''} />}
      />
      {values.kind !== 'personal' && values.drawdownType !== 'static' ? (
        <NumericInput label="Drawdown remaining" prefix="$" value={ddRemaining} onChangeText={setDdRemaining} hint="Optional — from your firm dashboard" />
      ) : null}

      {issues.length ? (
        <Card tone="danger">
          <AppText variant="bodyStrong" tone="danger">
            Fix the account configuration first
          </AppText>
          {issues.map((i) => (
            <AppText key={i.message} variant="body" style={{ marginTop: 4 }}>
              • {i.message}
            </AppText>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Your risk limits" />
      <AppText variant="caption">Your personal limits sit inside the account’s rules.</AppText>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Max risk per trade" prefix="$" value={riskPerTrade} onChangeText={setRiskPerTrade} error={riskErrors.risk} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Max daily loss" prefix="$" value={dailyLoss} onChangeText={setDailyLoss} error={riskErrors.daily} />
        </View>
      </View>
      <ChoiceGrid
        label="Max trades per day"
        columns={4}
        options={[
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: 'custom', label: 'Custom' },
        ]}
        value={maxTrades}
        onChange={setMaxTrades}
      />
      {maxTrades === 'custom' ? <NumericInput label="Custom max trades" value={customTrades} onChangeText={setCustomTrades} keyboardType="number-pad" /> : null}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, flex: { flex: 1 } });
