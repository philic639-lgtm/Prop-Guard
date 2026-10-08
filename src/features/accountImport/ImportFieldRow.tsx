import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Chip, SegmentedControl } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { confidenceBand, DATE_FIELDS, FIELD_HELP, FIELD_LABEL, MONEY_FIELDS, type ExtractedField, type FieldKey } from '@/lib/engines/accountImport';
import { parseNum } from '@/utils/format';

const fmtMoney = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const displayValue = (key: FieldKey, v: number | string) =>
  typeof v === 'number' ? `${key === 'netPnl' || key === 'dailyPnl' ? (v < 0 ? '−' : '+') : ''}$${fmtMoney(Math.abs(v))}` : key === 'stage' ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : String(v);

const SOURCE_LABEL = { ocr: 'Read', vision: 'Advanced reader', derived: 'Calculated', user: 'You edited' } as const;

interface Props {
  k: FieldKey;
  field: ExtractedField | undefined;
  edited: boolean;
  onChange: (v: number | string | null) => void;
  onReset: () => void;
  /** Extra line under the row (e.g. "Verified rule $2,000 is kept"). */
  note?: string;
}

/** One reviewed value: editable, with confidence, provenance and "Not detected". */
export function ImportFieldRow({ k, field, edited, onChange, onReset, note }: Props) {
  const isMoney = (MONEY_FIELDS as FieldKey[]).includes(k);
  const isDate = (DATE_FIELDS as FieldKey[]).includes(k);
  const value = field?.value;
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? '' : typeof value === 'number' ? String(value) : String(value));
  const band = field && field.source !== 'user' ? confidenceBand(field.confidence) : null;
  const low = band === 'low';
  const border = low ? colors.warning : band === 'medium' ? colors.warning + '66' : colors.border;

  const commit = (t: string) => {
    setText(null);
    const trimmed = t.trim();
    if (!trimmed) return onChange(null);
    if (isMoney) {
      const n = parseNum(trimmed.replace(/[$,\s]/g, ''));
      if (n != null) onChange(n);
    } else if (isDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) onChange(trimmed);
    } else onChange(trimmed.slice(0, 60));
  };

  return (
    <View style={[styles.row, { borderColor: border }, low && styles.lowBg]} accessibilityLabel={`${FIELD_LABEL[k]}: ${value == null ? 'not detected' : displayValue(k, value)}${low ? ', low confidence' : ''}`}>
      <View style={styles.head}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {FIELD_LABEL[k]}
        </AppText>
        {field ? (
          <AppText variant="caption" style={{ color: field.source === 'user' ? colors.accentBright : low ? colors.warning : band === 'medium' ? colors.warning : colors.positive }}>
            {field.source === 'user' ? SOURCE_LABEL.user : `${SOURCE_LABEL[field.source]} · ${low ? 'check this' : band === 'medium' ? 'verify' : 'high confidence'}`}
          </AppText>
        ) : (
          <AppText variant="caption" tone="tertiary">
            Not detected
          </AppText>
        )}
      </View>
      {FIELD_HELP[k] ? (
        <AppText variant="caption" tone="tertiary">
          {FIELD_HELP[k]}
        </AppText>
      ) : null}
      {k === 'stage' ? (
        <SegmentedControl
          options={[
            { value: 'evaluation', label: 'Evaluation' },
            { value: 'funded', label: 'Funded' },
            { value: 'live', label: 'Live' },
          ]}
          value={(value as 'evaluation' | 'funded' | 'live' | undefined) ?? null}
          onChange={(v) => onChange(v)}
        />
      ) : (
        <View style={styles.inputRow}>
          {isMoney ? (
            <AppText variant="body" tone="secondary">
              $
            </AppText>
          ) : null}
          <TextInput
            accessibilityLabel={FIELD_LABEL[k]}
            value={shown}
            placeholder={isDate ? 'YYYY-MM-DD' : 'Not detected — enter if you know it'}
            placeholderTextColor={colors.textTertiary}
            onChangeText={setText}
            onBlur={() => text != null && commit(text)}
            onSubmitEditing={() => text != null && commit(text)}
            keyboardType={isMoney ? 'decimal-pad' : 'default'}
            inputMode={isMoney ? 'decimal' : 'text'}
            style={styles.input}
          />
          {edited ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Undo edit to ${FIELD_LABEL[k]}`} hitSlop={10} onPress={() => (setText(null), onReset())}>
              <Ionicons name="arrow-undo-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : value != null ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${FIELD_LABEL[k]}`} hitSlop={10} onPress={() => (setText(null), onChange(null))}>
              <Ionicons name="close-circle-outline" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </View>
      )}
      {field?.alternatives?.length ? (
        <View style={styles.alts}>
          <AppText variant="caption" tone="warning">
            Screenshots disagree — pick one:
          </AppText>
          {[field.value, ...field.alternatives.map((a) => a.value)].map((v) => (
            <Chip key={String(v)} label={displayValue(k, v)} onPress={() => onChange(v)} />
          ))}
        </View>
      ) : null}
      {field && field.source !== 'user' ? (
        <AppText variant="caption" tone="tertiary" numberOfLines={2}>
          {field.evidence}
          {field.page >= 0 ? ` · screenshot ${field.page + 1}` : ''}
        </AppText>
      ) : null}
      {note ? (
        <AppText variant="caption" tone="accent">
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 4, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: colors.surface },
  lowBg: { backgroundColor: colors.warningMuted },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  input: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '600', paddingVertical: 6, fontVariant: ['tabular-nums'] },
  alts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
});
