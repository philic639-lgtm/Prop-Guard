import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Controller, useWatch, type Control } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Input, NumericInput, SectionHeader, SegmentedControl } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { FirmRuleField, FirmRuleValues, Permission } from '@/types/domain';

import type { AccountFormValues } from './accountSchema';
import { ImportedTag } from './FirmRulePicker';

type Name = keyof AccountFormValues;

/** Imported firm values (for "Firm rule" / "Custom override" tags) and how to restore one. */
interface ImportProps {
  imported?: FirmRuleValues;
  onRestore?: (field: FirmRuleField, value: string) => void;
}

function Tag({ control, name, imported, onRestore }: { control: Control<AccountFormValues>; name: FirmRuleField } & ImportProps) {
  const current = useWatch({ control, name });
  const value = imported?.[name];
  if (value == null) return null;
  return <ImportedTag imported={value} current={String(current ?? '')} onRestore={() => onRestore?.(name, value)} />;
}

function Money({ control, name, label, hint, prefix = '$', ...imp }: { control: Control<AccountFormValues>; name: Name; label: string; hint?: string; prefix?: string } & ImportProps) {
  return (
    <View style={styles.field}>
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) => (
          <NumericInput label={label} value={String(field.value ?? '')} onChangeText={field.onChange} onBlur={field.onBlur} prefix={prefix || undefined} hint={hint} error={fieldState.error?.message} />
        )}
      />
      <Tag control={control} name={name as FirmRuleField} {...imp} />
    </View>
  );
}

function Text({ control, name, label, placeholder, multiline, ...imp }: { control: Control<AccountFormValues>; name: Name; label: string; placeholder?: string; multiline?: boolean } & ImportProps) {
  return (
    <View style={styles.field}>
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) => (
          <Input label={label} value={String(field.value ?? '')} onChangeText={field.onChange} onBlur={field.onBlur} placeholder={placeholder} multiline={multiline} error={fieldState.error?.message} />
        )}
      />
      <Tag control={control} name={name as FirmRuleField} {...imp} />
    </View>
  );
}

function Allowed({ control, name, label, ...imp }: { control: Control<AccountFormValues>; name: Name; label: string } & ImportProps) {
  return (
    <View style={styles.field}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <SegmentedControl<Permission | 'unset'>
            label={label}
            options={[
              { value: 'allowed', label: 'Allowed' },
              { value: 'not_allowed', label: 'Not allowed' },
              { value: 'unset', label: 'Not set' },
            ]}
            value={(field.value as Permission) || 'unset'}
            onChange={(v) => field.onChange(v === 'unset' ? '' : v)}
          />
        )}
      />
      <Tag control={control} name={name as FirmRuleField} {...imp} />
    </View>
  );
}

const MORE_FIELDS: Name[] = ['maxTradingDays', 'minProfitableDays', 'payoutFrequency', 'payoutRequirements', 'scalingRule', 'positionLimits', 'activationThreshold', 'newsTrading', 'overnight', 'weekendHolding', 'copyTrading'];

/**
 * Account + prop rule fields. Values are entered by the trader or imported
 * from a VERIFIED firm rule version — never assumed. Every field stays editable.
 */
export function AccountFields({
  control,
  showIdentity = true,
  firmSlot,
  rulesFooter,
  imported,
  onRestore,
}: {
  control: Control<AccountFormValues>;
  showIdentity?: boolean;
  /** Replaces the plain Firm input (firm autocomplete + program picker). */
  firmSlot?: ReactNode;
  /** Shown under the rules (imported-rules status). */
  rulesFooter?: ReactNode;
} & ImportProps) {
  const imp = { imported, onRestore };
  const moreValues = useWatch({ control, name: MORE_FIELDS });
  const hasMore = moreValues.some((v) => !!v) || MORE_FIELDS.some((k) => imported?.[k as FirmRuleField] != null);
  const [showMore, setShowMore] = useState(false);
  const moreOpen = showMore || hasMore;

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
          {firmSlot ?? (
            <Controller
              control={control}
              name="firm"
              render={({ field }) => <Input label="Firm" value={field.value} onChangeText={field.onChange} placeholder="Prop firm or broker" />}
            />
          )}
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
          <Money control={control} name="size" label="Account size" {...imp} />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="balance" label="Current balance" />
        </View>
      </View>

      <SectionHeader title="Account rules" />
      <AppText variant="caption">Enter the rules from your firm&apos;s current terms, or pick a firm program with verified rules. Prop Guard never assumes firm-specific rules.</AppText>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="dailyLossLimit" label="Daily loss limit" {...imp} />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="maxDrawdown" label="Max drawdown" {...imp} />
        </View>
      </View>
      <View style={styles.field}>
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
        <Tag control={control} name="drawdownType" {...imp} />
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="profitTarget" label="Profit target" {...imp} />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="maxContracts" label="Max contracts" prefix="" {...imp} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Money control={control} name="consistencyPct" label="Consistency rule" prefix="" hint="Max % of profit in one day" {...imp} />
        </View>
        <View style={styles.flex}>
          <Money control={control} name="minTradingDays" label="Min trading days" prefix="" {...imp} />
        </View>
      </View>
      <Money control={control} name="payoutThreshold" label="Payout threshold" hint="Optional" {...imp} />

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreOpen }} onPress={() => setShowMore((v) => !v)} disabled={hasMore} style={styles.toggle}>
        <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
        <AppText variant="label">More firm rules{hasMore ? '' : ' (optional)'}</AppText>
      </Pressable>
      {moreOpen ? (
        <>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Money control={control} name="maxTradingDays" label="Max trading days" prefix="" {...imp} />
            </View>
            <View style={styles.flex}>
              <Money control={control} name="minProfitableDays" label="Min profitable days" prefix="" {...imp} />
            </View>
          </View>
          <Text control={control} name="payoutFrequency" label="Payout frequency" placeholder="e.g. every 5 winning days" {...imp} />
          <Text control={control} name="payoutRequirements" label="Payout eligibility" placeholder="One requirement per line" multiline {...imp} />
          <Text control={control} name="scalingRule" label="Scaling rules" placeholder="How contract limits grow with profit" {...imp} />
          <Text control={control} name="positionLimits" label="Position limits" placeholder="e.g. per-instrument limits" {...imp} />
          <Text control={control} name="activationThreshold" label="Activation / funded threshold" placeholder="What unlocks the funded / live stage" {...imp} />
          <Allowed control={control} name="newsTrading" label="News trading" {...imp} />
          <Allowed control={control} name="overnight" label="Overnight holding" {...imp} />
          <Allowed control={control} name="weekendHolding" label="Weekend holding" {...imp} />
          <Allowed control={control} name="copyTrading" label="Copy trading" {...imp} />
        </>
      ) : null}
      {rulesFooter}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  field: { gap: spacing.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
});
