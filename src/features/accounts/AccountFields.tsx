import { Controller, type Control } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { AppText, Input, NumericInput, SectionHeader, SegmentedControl } from '@/components/ui';
import { spacing } from '@/constants/theme';

import type { AccountFormValues } from './accountSchema';

type Name = keyof AccountFormValues;

function Money({ control, name, label, hint, prefix = '$' }: { control: Control<AccountFormValues>; name: Name; label: string; hint?: string; prefix?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <NumericInput label={label} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} prefix={prefix || undefined} hint={hint} error={fieldState.error?.message} />
      )}
    />
  );
}

/** Account + prop rule fields. Rules are always user-entered — no firm presets are assumed. */
export function AccountFields({ control, showIdentity = true }: { control: Control<AccountFormValues>; showIdentity?: boolean }) {
  return (
    <View style={styles.wrap}>
      {showIdentity ? (
        <>
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <Input label="Account name" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="Lucid 25K Flex" error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="firm"
            render={({ field }) => <Input label="Firm" value={field.value} onChangeText={field.onChange} placeholder="Prop firm or broker" />}
          />
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SegmentedControl
                label="Account type"
                options={[
                  { value: 'prop', label: 'Prop firm' },
                  { value: 'personal', label: 'Personal' },
                ]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </>
      ) : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="size" label="Account size" />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="balance" label="Current balance" />
        </View>
      </View>

      <SectionHeader title="Account rules" />
      <AppText variant="caption">Enter the rules from your firm&apos;s current terms. Prop Guard never assumes firm-specific rules.</AppText>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="dailyLossLimit" label="Daily loss limit" />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="maxDrawdown" label="Max drawdown" />
        </View>
      </View>
      <Controller
        control={control}
        name="drawdownType"
        render={({ field }) => (
          <SegmentedControl
            label="Drawdown type"
            options={[
              { value: 'eod_trailing', label: 'EOD trail' },
              { value: 'trailing', label: 'Intraday' },
              { value: 'static', label: 'Static' },
            ]}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="profitTarget" label="Profit target" />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="maxContracts" label="Max contracts" prefix="" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="consistencyPct" label="Consistency rule" prefix="" hint="Max % of profit in one day" />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="minTradingDays" label="Min trading days" prefix="" />
        </View>
      </View>
      <Money control={control} name="payoutThreshold" label="Payout threshold" hint="Optional" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
