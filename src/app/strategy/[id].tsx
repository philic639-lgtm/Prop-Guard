import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  AppHeader,
  AppText,
  Button,
  Card,
  Chip,
  ConfirmationSheet,
  Input,
  NumericInput,
  Screen,
  SectionHeader,
  ToggleRow,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { blankStrategy, strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { InstrumentBrowser } from '@/features/instruments/InstrumentBrowser';
import { sourceTypeAfterEdit, validateStrategy } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { ChecklistItem, InstrumentSymbol, Strategy } from '@/types/domain';
import { numToInput, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const clock = z
  .string()
  .trim()
  .refine((v) => v === '' || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v), 'Use 24h HH:mm, e.g. 09:45');
const optionalNum = z
  .string()
  .trim()
  .refine((v) => v === '' || (parseNum(v) != null && parseNum(v)! >= 0), 'Enter a number');

const schema = z.object({
  name: z.string().trim().min(1, 'Name your strategy').max(60),
  session: z.string().trim().max(60),
  timeframe: z.string().trim().max(60),
  entryWindowStart: clock,
  entryWindowEnd: clock,
  biasRequirement: z.string().trim().max(80),
  entryTrigger: z.string().trim().max(300),
  confirmationRules: z.string().trim().max(300),
  retestRules: z.string().trim().max(300),
  stopMethod: z.string().trim().max(200),
  typicalStopMin: optionalNum,
  typicalStopMax: optionalNum,
  targetMethod: z.string().trim().max(200),
  minRR: z.string().refine((v) => (parseNum(v) ?? 0) > 0, 'Must be greater than 0'),
  maxTrades: z.string().refine((v) => Number.isInteger(parseNum(v)) && (parseNum(v) ?? 0) >= 1, 'At least 1'),
  invalidationRules: z.string().trim().max(300),
  notes: z.string().trim().max(1000),
});
type FormValues = z.infer<typeof schema>;

function toForm(s: Strategy): FormValues {
  return {
    name: s.name,
    session: s.session,
    timeframe: s.timeframe,
    entryWindowStart: s.entryWindowStart ?? '',
    entryWindowEnd: s.entryWindowEnd ?? '',
    biasRequirement: s.biasRequirement,
    entryTrigger: s.entryTrigger,
    confirmationRules: s.confirmationRules,
    retestRules: s.retestRules,
    stopMethod: s.stopMethod,
    typicalStopMin: numToInput(s.typicalStopMin),
    typicalStopMax: numToInput(s.typicalStopMax),
    targetMethod: s.targetMethod,
    minRR: String(s.minRR),
    maxTrades: String(s.maxTrades),
    invalidationRules: s.invalidationRules,
    notes: s.notes,
  };
}

export default function StrategyBuilder() {
  const { id, template } = useLocalSearchParams<{ id: string; template?: string }>();
  const strategies = useAppStore((s) => s.strategies);
  const activeId = useAppStore((s) => s.activeStrategyId);
  const markets = useAppStore((s) => s.preferences.markets);
  const upsert = useAppStore((s) => s.upsertStrategy);
  const remove = useAppStore((s) => s.deleteStrategy);
  const setActive = useAppStore((s) => s.setActiveStrategy);

  const existing = strategies.find((s) => s.id === id) ?? null;
  const initial = useMemo<Strategy>(() => {
    if (existing) return existing;
    const t = template ? getTemplate(template) : undefined;
    return t ? strategyFromTemplate(t, markets) : blankStrategy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, template]);

  const [selectedMarkets, setSelectedMarkets] = useState<InstrumentSymbol[]>(initial.markets);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial.checklist);
  const [requiresBias, setRequiresBias] = useState(initial.requiresBiasAlignment);
  const [newItem, setNewItem] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { control, handleSubmit } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(initial), mode: 'onBlur' });

  const onSave = handleSubmit((v) => {
    const strategy: Strategy = {
      ...initial,
      name: v.name,
      markets: selectedMarkets,
      session: v.session,
      timeframe: v.timeframe,
      entryWindowStart: v.entryWindowStart || null,
      entryWindowEnd: v.entryWindowEnd || null,
      biasRequirement: v.biasRequirement,
      requiresBiasAlignment: requiresBias,
      entryTrigger: v.entryTrigger,
      confirmationRules: v.confirmationRules,
      retestRules: v.retestRules,
      stopMethod: v.stopMethod,
      typicalStopMin: parseNum(v.typicalStopMin),
      typicalStopMax: parseNum(v.typicalStopMax),
      targetMethod: v.targetMethod,
      minRR: parseNum(v.minRR)!,
      maxTrades: parseNum(v.maxTrades)!,
      invalidationRules: v.invalidationRules,
      notes: v.notes,
      checklist,
      updatedAt: new Date().toISOString(),
    };
    strategy.sourceType = sourceTypeAfterEdit(initial, strategy);
    const problems = validateStrategy(strategy);
    setErrors(problems);
    if (problems.length > 0) return;
    upsert(strategy);
    if (!existing && strategies.length === 0) setActive(strategy.id);
    router.back();
  });

  const toggleMarket = (m: InstrumentSymbol) =>
    setSelectedMarkets((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    setChecklist((c) => [...c, { id: `c_${uuid().slice(0, 8)}`, label, kind: 'yesno', required: true }]);
    setNewItem('');
  };

  return (
    <Screen
      header={<AppHeader title={existing ? 'Edit strategy' : 'Strategy builder'} back />}
      footer={<Button label="Save strategy" icon="checkmark" onPress={onSave} />}>
      <Field control={control} name="name" label="Strategy name" placeholder="15M ORB" />

      <View style={{ gap: spacing.sm }}>
        <AppText variant="label">Markets</AppText>
        <View style={styles.chips}>
          {[...new Set([...markets, ...selectedMarkets])].map((m) => (
            <Chip key={m} label={m} selected={selectedMarkets.includes(m)} onPress={() => toggleMarket(m)} />
          ))}
          <Chip label="Browse all" icon="search" onPress={() => setBrowsing(true)} />
        </View>
        <InstrumentBrowser visible={browsing} selected={selectedMarkets} onToggle={toggleMarket} onClose={() => setBrowsing(false)} />
      </View>

      <View style={styles.row}>
        <View style={styles.flex}>
          <Field control={control} name="session" label="Session" placeholder="NY Open" />
        </View>
        <View style={styles.flex}>
          <Field control={control} name="timeframe" label="Timeframe" placeholder="15m / 5m" />
        </View>
      </View>

      <SectionHeader title="Entry window (ET)" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field control={control} name="entryWindowStart" label="Start" placeholder="09:45" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={styles.flex}>
          <Field control={control} name="entryWindowEnd" label="End" placeholder="10:45" keyboardType="numbers-and-punctuation" />
        </View>
      </View>

      <SectionHeader title="Entry rules" />
      <Field control={control} name="biasRequirement" label="Market bias requirement" placeholder="1H trend" />
      <Card>
        <ToggleRow label="Direction must match bias" description="Longs only with bullish bias, shorts only with bearish." value={requiresBias} onChange={setRequiresBias} />
      </Card>
      <Field control={control} name="entryTrigger" label="Entry trigger" placeholder="5-minute candle closes outside the ORB" multiline />
      <Field control={control} name="confirmationRules" label="Confirmation rules" multiline />
      <Field control={control} name="retestRules" label="Retest rules" placeholder="Up to three 1-minute candles" multiline />

      <SectionHeader title="Risk & targets" />
      <Field control={control} name="stopMethod" label="Stop method" placeholder="Below the retest candle" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field control={control} name="typicalStopMin" label="Typical stop min" suffix="pts" numeric />
        </View>
        <View style={styles.flex}>
          <Field control={control} name="typicalStopMax" label="Typical stop max" suffix="pts" numeric />
        </View>
      </View>
      <Field control={control} name="targetMethod" label="Target method" placeholder="2R fixed" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field control={control} name="minRR" label="Minimum R:R" prefix="1 :" numeric />
        </View>
        <View style={styles.flex}>
          <Field control={control} name="maxTrades" label="Max trades / day" numeric />
        </View>
      </View>
      <Field control={control} name="invalidationRules" label="Invalidation rules" multiline />

      <SectionHeader title="Pre-trade checklist" />
      <Card>
        {checklist.length === 0 ? (
          <AppText variant="caption">Add the yes/no confirmations you need before every entry.</AppText>
        ) : (
          checklist.map((c, i) => (
            <View key={c.id} style={[styles.item, i > 0 && styles.itemBorder]}>
              <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
              <AppText variant="body" style={styles.flex}>
                {c.label}
              </AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${c.label}`} hitSlop={10} onPress={() => setChecklist((cur) => cur.filter((x) => x.id !== c.id))}>
                <Ionicons name="close" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))
        )}
        <View style={[styles.row, { marginTop: spacing.md }]}>
          <View style={styles.flex}>
            <Input value={newItem} onChangeText={setNewItem} placeholder="e.g. Retest occurred" onSubmitEditing={addItem} returnKeyType="done" />
          </View>
          <Button label="Add" size="md" variant="secondary" onPress={addItem} />
        </View>
      </Card>

      <Field control={control} name="notes" label="Notes" multiline />

      {errors.length > 0 ? (
        <Card tone="danger">
          {errors.map((e) => (
            <AppText key={e} variant="body" tone="danger">
              • {e}
            </AppText>
          ))}
        </Card>
      ) : null}

      {existing ? (
        <>
          {activeId !== existing.id ? <Button label="Set as active strategy" variant="secondary" onPress={() => setActive(existing.id)} /> : null}
          <Button label="Delete strategy" variant="ghost" onPress={() => setConfirmDelete(true)} />
        </>
      ) : null}

      <ConfirmationSheet
        visible={confirmDelete}
        title="Delete strategy"
        message="Past trades keep their history, but they will no longer be linked to this strategy."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (existing) remove(existing.id);
          setConfirmDelete(false);
          router.back();
        }}
      />
    </Screen>
  );
}

function Field({
  control,
  name,
  label,
  placeholder,
  multiline,
  numeric,
  prefix,
  suffix,
  keyboardType,
}: {
  control: Control<FormValues>;
  name: keyof FormValues;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  prefix?: string;
  suffix?: string;
  keyboardType?: 'numbers-and-punctuation';
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) =>
        numeric ? (
          <NumericInput label={label} value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} prefix={prefix} suffix={suffix} />
        ) : (
          <Input
            label={label}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            multiline={multiline}
            keyboardType={keyboardType}
            error={fieldState.error?.message}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  itemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
