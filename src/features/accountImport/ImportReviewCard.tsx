import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Card, Chip, ToggleRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { ProgramOption } from '@/data/propFirms/types';
import type { FieldKey, ReviewIssue, ReviewRow, ReviewSource } from '@/lib/engines/accountImport';
import { parseNum } from '@/utils/format';

import { displayValue } from './ImportFieldRow';

const SOURCE: Record<ReviewSource, { label: string; color: string }> = {
  screenshot: { label: 'From screenshot', color: colors.accentBright },
  verified_rule: { label: 'Verified firm rule', color: colors.positive },
  calculated: { label: 'Calculated', color: colors.textSecondary },
  edited: { label: 'Edited by you', color: colors.accentBright },
  account: { label: 'Saved on the account', color: colors.textSecondary },
};

/** Rows the trader may type into (never verified rules or calculations). */
const editable = (r: ReviewRow) => r.source !== 'verified_rule' && r.source !== 'calculated';

function ValueRow({ row, onEdit, onConfirm }: { row: ReviewRow; onEdit: (k: FieldKey, v: number | null) => void; onConfirm: (k: FieldKey) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const start = () => {
    setText(typeof row.value === 'number' ? String(row.value) : '');
    setEditing(true);
  };
  const save = () => {
    const t = text.replace(/[$,\s]/g, '');
    setEditing(false);
    if (!t) return onEdit(row.key, null);
    const n = parseNum(t);
    if (n != null) onEdit(row.key, n);
  };
  const warn = row.status === 'uncertain' || row.status === 'conflict' || (row.required && row.status === 'missing');
  const src = row.source ? SOURCE[row.source] : null;
  return (
    <View style={[styles.row, warn && styles.rowWarn]} accessibilityLabel={`${row.label}: ${row.value == null ? 'not detected' : displayValue(row.key, row.value)}`}>
      <View style={styles.rowHead}>
        <AppText variant="caption" tone="secondary" style={styles.flex}>
          {row.label}
          {row.required ? ' *' : ''}
        </AppText>
        {src ? (
          <AppText variant="caption" style={{ color: src.color }}>
            {src.label}
            {row.screenshot && row.source === 'screenshot' ? ` ${row.screenshot}` : ''}
          </AppText>
        ) : null}
      </View>
      {editing ? (
        <View style={styles.editRow}>
          <AppText variant="body" tone="secondary">
            {row.key === 'tradingDays' ? '' : '$'}
          </AppText>
          <TextInput
            autoFocus
            accessibilityLabel={`Enter ${row.label}`}
            value={text}
            onChangeText={setText}
            onSubmitEditing={save}
            onBlur={save}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="0.00"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
          />
        </View>
      ) : (
        <View style={styles.valueRow}>
          <AppText variant="heading" style={[styles.value, row.value == null && styles.missing]}>
            {row.value == null ? 'Not detected' : displayValue(row.key, row.value)}
          </AppText>
          {editable(row) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${row.value == null ? 'Add' : 'Edit'} ${row.label}`} onPress={start} hitSlop={8} style={styles.link}>
              <AppText variant="caption" tone="accent">
                {row.value == null ? 'Add' : 'Edit'}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      )}
      {row.status === 'conflict' && row.choices ? (
        <View style={styles.choices}>
          <AppText variant="caption" tone="warning">
            Your screenshots disagree — pick the right one:
          </AppText>
          {row.choices.map((c) => (
            <Chip key={String(c.value)} label={`${displayValue(row.key, c.value)} · screenshot ${c.screenshot}`} onPress={() => typeof c.value === 'number' && onEdit(row.key, c.value)} />
          ))}
        </View>
      ) : null}
      {row.status === 'uncertain' && !editing ? (
        <View style={styles.choices}>
          <AppText variant="caption" tone="warning" style={styles.flex}>
            Uncertain reading — compare with your dashboard.
          </AppText>
          <Chip label="Looks right" icon="checkmark" onPress={() => onConfirm(row.key)} />
        </View>
      ) : null}
      {row.note && row.status !== 'uncertain' ? (
        <AppText variant="caption" tone="tertiary">
          {row.note}
        </AppText>
      ) : null}
    </View>
  );
}

export interface ImportReviewCardProps {
  title: string;
  subtitle: string | null;
  /** New accounts: editable name. */
  name: string | null;
  onName: (v: string) => void;
  rows: ReviewRow[];
  issues: ReviewIssue[];
  acks: Record<string, boolean>;
  onAck: (id: string, v: boolean) => void;
  options: ProgramOption[];
  chosen: Record<string, string>;
  onChoose: (id: string, choice: string) => void;
  onEdit: (k: FieldKey, v: number | null) => void;
  onConfirm: (k: FieldKey) => void;
}

/** The essential account values — detected or required only — each with its source. */
export function ImportReviewCard(p: ImportReviewCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.gap}>
        {p.name != null ? (
          <TextInput accessibilityLabel="Account name" value={p.name} onChangeText={p.onName} placeholder="Account name" placeholderTextColor={colors.textTertiary} style={styles.name} maxLength={60} />
        ) : (
          <AppText variant="title">{p.title}</AppText>
        )}
        {p.subtitle ? (
          <AppText variant="caption" tone="secondary">
            {p.subtitle}
          </AppText>
        ) : null}
      </View>

      {p.options.map((o) => (
        <View key={o.id} style={styles.gap}>
          <AppText variant="caption" tone="warning">
            Choose your {o.label} option — it decides which verified rules apply.
          </AppText>
          <View style={styles.choices}>
            {o.choices.map((c) => (
              <Chip key={c.id} label={c.label} selected={p.chosen[o.id] === c.id} onPress={() => p.onChoose(o.id, c.id)} />
            ))}
          </View>
        </View>
      ))}

      {p.rows.map((r) => (
        <ValueRow key={r.key} row={r} onEdit={p.onEdit} onConfirm={p.onConfirm} />
      ))}

      {p.issues.length ? (
        <View style={[styles.gap, styles.issues]}>
          <View style={styles.rowHead}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <AppText variant="bodyStrong" style={{ color: colors.warning }}>
              Needs your attention
            </AppText>
          </View>
          {p.issues.map((i) => (
            <View key={i.id} style={styles.gap}>
              <AppText variant="caption">{i.message}</AppText>
              <ToggleRow label={i.kind === 'reset' ? 'The account was reset — start the floor over from this screenshot' : 'I checked this'} value={!!p.acks[i.id]} onChange={(v) => p.onAck(i.id, v)} />
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  gap: { gap: spacing.xs },
  flex: { flex: 1 },
  name: { color: colors.text, fontSize: 20, fontWeight: '700', paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  row: { gap: 2, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rowWarn: { borderColor: colors.warning, backgroundColor: colors.warningMuted },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { flex: 1, fontVariant: ['tabular-nums'] },
  missing: { color: colors.textTertiary, fontWeight: '500' },
  link: { paddingVertical: 4, paddingHorizontal: spacing.xs },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.accent },
  input: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '700', paddingVertical: 4, fontVariant: ['tabular-nums'] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  issues: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning + '66', backgroundColor: colors.warningMuted },
});
