import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, ChoiceGrid, Input, NumericInput, OptionCard, SectionHeader, SegmentedControl, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { accountSchema, accountToForm, formToAccount, type AccountFormValues } from '@/features/accounts/accountSchema';
import { OnboardingScaffold } from '@/features/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '@/features/onboarding/useOnboardingStore';
import type { ConnectionMethod, DrawdownType } from '@/types/domain';
import { money, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const SIZES = ['10000', '25000', '50000', '100000', '150000', 'custom'] as const;
const FIRMS = ['Lucid Trading', 'Apex', 'Topstep', 'Tradeify', 'My Funded Futures', 'Take Profit Trader', 'Personal account', 'Other'];

/** Account & risk setup — all limits are user-entered; no firm rules are assumed. */
export default function AccountStep() {
  const o = useOnboardingStore();
  const imported = o.imported;
  const [size, setSize] = useState<string>(o.account ? String(o.account.size) : '25000');
  const [customSize, setCustomSize] = useState('');
  const [firm, setFirm] = useState(o.propFirm || 'Lucid Trading');
  const [otherFirm, setOtherFirm] = useState('');
  const [name, setName] = useState(o.account?.name ?? '');
  const [balance, setBalance] = useState(imported?.balance != null ? String(imported.balance) : '');
  const [riskPerTrade, setRiskPerTrade] = useState(String(o.rules.maxRiskPerTrade === 150 ? 100 : o.rules.maxRiskPerTrade));
  const [dailyLoss, setDailyLoss] = useState(String(o.rules.dailyStop === 400 ? 200 : o.rules.dailyStop));
  const [maxTrades, setMaxTrades] = useState<string>(String(o.rules.maxTradesPerDay > 3 ? 'custom' : Math.min(o.rules.maxTradesPerDay, 2)));
  const [customTrades, setCustomTrades] = useState('4');
  const [target, setTarget] = useState('');
  const [maxDd, setMaxDd] = useState('');
  const [ddType, setDdType] = useState<DrawdownType>('eod_trailing');
  const [ddRemaining, setDdRemaining] = useState(imported?.drawdownRemaining != null ? String(imported.drawdownRemaining) : '');
  const [errors, setErrors] = useState<Partial<Record<keyof AccountFormValues | 'risk', string>>>({});

  // Apply confirmed screenshot values when the trader returns from the import screen.
  const [seenImport, setSeenImport] = useState(imported);
  if (imported !== seenImport) {
    setSeenImport(imported);
    if (imported?.balance != null) setBalance(String(imported.balance));
    if (imported?.drawdownRemaining != null) setDdRemaining(String(imported.drawdownRemaining));
  }

  const connection = o.profile.connection;
  const personal = firm === 'Personal account';
  const sizeNum = size === 'custom' ? (parseNum(customSize) ?? 0) : Number(size);
  const firmName = firm === 'Other' ? otherFirm.trim() : personal ? 'Personal' : firm;
  const defaultName = `${personal ? 'Personal' : firmName || 'Prop'} ${sizeNum >= 1000 ? `${Math.round(sizeNum / 1000)}K` : ''}`.trim();

  const next = () => {
    const values: AccountFormValues = {
      ...accountToForm(null),
      name: (name.trim() || defaultName).slice(0, 60),
      firm: firmName,
      kind: personal ? 'personal' : 'prop',
      size: String(sizeNum),
      balance: balance.trim() || String(sizeNum),
      profitTarget: target.trim() || (personal ? '' : String(Math.round(sizeNum * 0.06))),
      maxDrawdown: maxDd.trim() || (personal ? '' : String(Math.round(sizeNum * 0.06))),
      drawdownType: ddType,
      dailyLossLimit: dailyLoss,
      maxContracts: '',
      consistencyPct: '',
      minTradingDays: '',
      payoutThreshold: '',
    };
    const parsed = accountSchema.safeParse(values);
    const risk = parseNum(riskPerTrade);
    const daily = parseNum(dailyLoss);
    const errs: typeof errors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) errs[issue.path[0] as keyof AccountFormValues] = issue.message;
    if (!risk || risk <= 0) errs.risk = 'Enter your max risk per trade';
    else if (daily && risk > daily) errs.risk = 'Cannot exceed your max daily loss';
    if (!daily || daily <= 0) errs.dailyLossLimit = 'Enter your max daily loss';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const trades = maxTrades === 'custom' ? Math.max(1, Math.round(parseNum(customTrades) ?? 3)) : Number(maxTrades);
    const account = formToAccount(values, null, o.account?.id ?? uuid(), parseNum(ddRemaining));
    o.set({
      account,
      propFirm: firmName,
      tradingType: personal ? 'personal' : 'prop',
      rules: { ...o.rules, maxRiskPerTrade: risk!, dailyStop: daily!, maxTradesPerDay: trades },
    });
    router.push('/onboarding/preferences');
  };

  const chooseConnection = (c: ConnectionMethod) => {
    o.setProfile({ connection: c });
    if (c === 'screenshot') router.push('/onboarding/connect');
  };

  return (
    <OnboardingScaffold step={3} title="Let's set up your account" subtitle="This helps Prop Guard enforce limits that fit your account." cta="Continue" onNext={next}>
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

      <ChoiceGrid
        label="Account size"
        options={SIZES.map((s) => ({ value: s, label: s === 'custom' ? 'Custom' : `$${Number(s) / 1000}K` }))}
        value={size as (typeof SIZES)[number]}
        onChange={setSize}
      />
      {size === 'custom' ? <NumericInput label="Custom size" prefix="$" value={customSize} onChangeText={setCustomSize} error={errors.size} /> : null}

      <ChoiceGrid label="Prop firm / account type" columns={2} options={FIRMS.map((f) => ({ value: f, label: f }))} value={firm} onChange={setFirm} />
      {firm === 'Other' ? <Input label="Firm name" value={otherFirm} onChangeText={setOtherFirm} placeholder="Firm name" /> : null}
      <Input label="Account name" value={name} onChangeText={setName} placeholder={defaultName} error={errors.name} />

      <SectionHeader title="Risk limits" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Max risk per trade" prefix="$" value={riskPerTrade} onChangeText={setRiskPerTrade} error={errors.risk} />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Max daily loss" prefix="$" value={dailyLoss} onChangeText={setDailyLoss} error={errors.dailyLossLimit} />
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

      {!personal ? (
        <>
          <SectionHeader title="Prop account rules" />
          <AppText variant="caption">Use your firm&apos;s current terms. Prop Guard never assumes firm-specific rules.</AppText>
          <View style={styles.row}>
            <View style={styles.flex}>
              <NumericInput label="Profit target" prefix="$" value={target} onChangeText={setTarget} placeholder={String(Math.round(sizeNum * 0.06))} />
            </View>
            <View style={styles.flex}>
              <NumericInput label="Max drawdown" prefix="$" value={maxDd} onChangeText={setMaxDd} placeholder={String(Math.round(sizeNum * 0.06))} error={errors.maxDrawdown} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <NumericInput label="Current balance" prefix="$" value={balance} onChangeText={setBalance} placeholder={String(sizeNum)} error={errors.balance} />
            </View>
            <View style={styles.flex}>
              <NumericInput label="Drawdown remaining" prefix="$" value={ddRemaining} onChangeText={setDdRemaining} hint="Optional" />
            </View>
          </View>
          <SegmentedControl
            label="Drawdown type"
            options={[
              { value: 'eod_trailing', label: 'EOD trail' },
              { value: 'trailing', label: 'Intraday' },
              { value: 'static', label: 'Static' },
            ]}
            value={ddType}
            onChange={setDdType}
          />
        </>
      ) : (
        <NumericInput label="Current balance" prefix="$" value={balance} onChangeText={setBalance} placeholder={String(sizeNum)} />
      )}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }, flex: { flex: 1 } });
