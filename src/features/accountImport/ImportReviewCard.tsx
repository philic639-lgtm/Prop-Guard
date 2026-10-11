import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { AppText, Chip, StatusBadge, ToggleRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';
import type { ProgramOption } from '@/data/propFirms/types';
import { REVIEW_STATE_LABEL, type CardStatus, type DetailRow, type FieldKey, type ReviewIssue, type ReviewRow, type ReviewSource, type ReviewState, type SummaryCard } from '@/lib/engines/accountImport';
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

type Tone = { fg: string; bg: string; border: string };
/** Only verified firm rules are green. OCR readings are neutral until confirmed; problems are amber. */
const TONE: Record<CardStatus, Tone> = {
  verified: { fg: colors.positive, bg: colors.surface, border: colors.border },
  extracted: { fg: colors.textSecondary, bg: colors.surface, border: colors.border },
  confirmed: { fg: colors.accentBright, bg: colors.surface, border: colors.border },
  entered: { fg: colors.accentBright, bg: colors.surface, border: colors.border },
  calculated: { fg: colors.textSecondary, bg: colors.surface, border: colors.border },
  missing: { fg: colors.textTertiary, bg: colors.surface, border: colors.border },
  conflict: { fg: colors.warning, bg: colors.warningMuted, border: colors.warning },
  review: { fg: colors.warning, bg: colors.warningMuted, border: colors.warning },
};
const STATE_TONE: Record<ReviewState, 'positive' | 'warning' | 'danger'> = { ready: 'positive', needs_review: 'warning', missing_info: 'warning', failed: 'danger' };
const STATE_ICON: Record<ReviewState, 'checkmark-circle' | 'alert-circle' | 'help-circle' | 'close-circle'> = { ready: 'checkmark-circle', needs_review: 'alert-circle', missing_info: 'help-circle', failed: 'close-circle' };

/** One of the four summary cards: label, amount, status and an edit control. */
function SummaryTile({ card, onEdit, onConfirm, editThreshold }: { card: SummaryCard; onEdit: (k: FieldKey, v: number | null) => void; onConfirm: (k: FieldKey) => void; editThreshold: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const t = TONE[card.status];
  // Remaining drawdown is calculated: the trader edits its input (the liquidation threshold) instead.
  const editKey: FieldKey | null = card.editable ? card.key : card.key === 'drawdownRemaining' && editThreshold ? 'drawdownThreshold' : null;
  const editLabel = card.key === 'drawdownRemaining' ? 'Enter threshold' : card.value == null ? 'Add' : 'Edit';
  const save = () => {
    const raw = text.replace(/[$,\s]/g, '');
    setEditing(false);
    if (!editKey) return;
    if (!raw) return onEdit(editKey, null);
    const n = parseNum(raw);
    if (n != null) onEdit(editKey, n);
  };
  return (
    <View style={[styles.tile, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityLabel={`${card.label}: ${card.value == null ? 'missing' : displayValue(card.key, card.value)}. ${card.statusLabel}`}>
      <AppText variant="caption" tone="secondary" numberOfLines={1}>
        {card.label}
      </AppText>
      {editing ? (
        <TextInput
          autoFocus
          accessibilityLabel={`Enter ${card.key === 'drawdownRemaining' ? 'liquidation threshold' : card.label}`}
          value={text}
          onChangeText={setText}
          onSubmitEditing={save}
          onBlur={save}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder={card.key === 'drawdownRemaining' ? 'Threshold, e.g. 24270' : '0.00'}
          placeholderTextColor={colors.textTertiary}
          style={styles.tileInput}
        />
      ) : (
        <AppText variant="heading" style={[styles.amount, card.value == null && styles.missing]} numberOfLines={1} adjustsFontSizeToFit>
          {card.value == null ? '—' : displayValue(card.key, card.value)}
        </AppText>
      )}
      <View style={styles.statusRow}>
        {card.status === 'verified' ? <Icon name="shield-checkmark" size={12} color={t.fg} /> : null}
        <AppText variant="caption" style={[styles.flex, { color: t.fg }]}>
          {card.statusLabel}
        </AppText>
      </View>
      {card.note ? (
        <AppText variant="caption" tone="tertiary">
          {card.note}
        </AppText>
      ) : null}
      {card.choices?.length ? (
        <View style={styles.choices}>
          {card.choices.map((c) => (
            <Chip key={`${c.value}-${c.screenshot}`} label={`${displayValue(card.key, c.value)} · #${c.screenshot}`} onPress={() => onEdit(card.key, c.value)} />
          ))}
        </View>
      ) : null}
      <View style={styles.choices}>
        {card.confirmKey && !editing ? <Chip label="Looks right" icon="checkmark" onPress={() => onConfirm(card.confirmKey!)} /> : null}
        {editKey && !editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${editLabel} ${card.key === 'drawdownRemaining' ? 'liquidation threshold' : card.label}`}
            onPress={() => {
              setText(card.key !== 'drawdownRemaining' && card.value != null ? String(card.value) : '');
              setEditing(true);
            }}
            hitSlop={8}
            style={styles.link}>
            <AppText variant="caption" tone="accent">
              {editLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export interface ImportReviewCardProps {
  /** "Lucid 25K" — program or account name. */
  title: string;
  subtitle: string | null;
  state: ReviewState;
  notice: string | null;
  /** New accounts: editable name. */
  name: string | null;
  onName: (v: string) => void;
  summary: SummaryCard[];
  details: DetailRow[];
  /** Required values outside the four cards (e.g. account size when no program matched). */
  extraRows: ReviewRow[];
  issues: ReviewIssue[];
  acks: Record<string, boolean>;
  onAck: (id: string, v: boolean) => void;
  /** Tied programs to pick from (the screenshot shows no stage, e.g. Evaluation vs Funded). */
  programChoices: { programId: string; name: string }[];
  onPickProgram: (id: string) => void;
  options: ProgramOption[];
  chosen: Record<string, string>;
  onChoose: (id: string, choice: string) => void;
  onEdit: (k: FieldKey, v: number | null) => void;
  onConfirm: (k: FieldKey) => void;
}

/** Compact review: header + status, smart notice, four summary cards, collapsible details. */
export function ImportReviewCard(p: ImportReviewCardProps) {
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const oneColumn = width < 360;
  return (
    <View style={styles.card}>
      <View style={styles.gap}>
        <AppText variant="caption" tone="secondary">
          Review Imported Account
        </AppText>
        {p.name != null ? (
          <TextInput accessibilityLabel="Account name" value={p.name} onChangeText={p.onName} placeholder="Account name" placeholderTextColor={colors.textTertiary} style={styles.name} maxLength={60} />
        ) : (
          <AppText variant="title">{p.title}</AppText>
        )}
        {p.subtitle ? (
          <AppText variant="caption" tone="tertiary">
            {p.subtitle}
          </AppText>
        ) : null}
        <View style={styles.rowHead}>
          <StatusBadge label={REVIEW_STATE_LABEL[p.state]} tone={STATE_TONE[p.state]} icon={STATE_ICON[p.state]} size="sm" />
        </View>
      </View>

      {p.notice ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Icon name="alert-circle-outline" size={16} color={colors.warning} />
          <AppText variant="caption" style={[styles.flex, { color: colors.warning }]}>
            {p.notice}
          </AppText>
        </View>
      ) : null}

      {p.programChoices.length > 1 ? (
        <View style={styles.gap}>
          <AppText variant="caption" tone="warning">
            Which plan is this? The screenshot does not show it — your choice loads that plan’s verified rules.
          </AppText>
          <View style={styles.choices}>
            {p.programChoices.map((c) => (
              <Chip key={c.programId} label={c.name} onPress={() => p.onPickProgram(c.programId)} />
            ))}
          </View>
        </View>
      ) : null}

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

      {p.extraRows.map((r) => (
        <ValueRow key={r.key} row={r} onEdit={p.onEdit} onConfirm={p.onConfirm} />
      ))}

      <View style={styles.grid}>
        {p.summary.map((c) => (
          <View key={c.key} style={oneColumn ? styles.full : styles.half}>
            <SummaryTile card={c} onEdit={p.onEdit} onConfirm={p.onConfirm} editThreshold />
          </View>
        ))}
      </View>

      {p.issues.length ? (
        <View style={[styles.gap, styles.issues]}>
          <View style={styles.rowHead}>
            <Icon name="alert-circle-outline" size={16} color={colors.warning} />
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

      <Pressable accessibilityRole="button" aria-expanded={open} onPress={() => setOpen((o) => !o)} style={styles.detailsHead}>
        <AppText variant="bodyStrong" style={styles.flex}>
          Additional Account Details
        </AppText>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <View style={styles.details}>
          {p.details.map((d) => (
            <View key={d.key} style={styles.detailRow}>
              <View style={styles.rowHead}>
                <AppText variant="caption" tone="secondary" style={styles.flex}>
                  {d.label}
                </AppText>
                <AppText variant="bodyStrong" style={styles.num}>
                  {d.value}
                </AppText>
              </View>
              {d.note ? (
                <AppText variant="caption" tone="tertiary">
                  {d.note}
                </AppText>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs / 2, rowGap: spacing.sm },
  half: { width: '50%', paddingHorizontal: spacing.xs / 2 },
  full: { width: '100%', paddingHorizontal: spacing.xs / 2 },
  tile: { flex: 1, gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, minWidth: 0 },
  amount: { fontVariant: ['tabular-nums'] },
  tileInput: { color: colors.text, fontSize: 18, fontWeight: '700', paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.accent, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.warningMuted },
  detailsHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  details: { gap: spacing.sm },
  detailRow: { gap: 2 },
  num: { fontVariant: ['tabular-nums'] },
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
