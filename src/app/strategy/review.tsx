import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppHeader,
  AppText,
  Button,
  Card,
  DetailTable,
  EmptyState,
  Input,
  NumericInput,
  Screen,
  SectionHeader,
  Sheet,
  StatusBadge,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { sourceTypeAfterEdit, strategyRules, strategySourceLabel, strategySourceType, validateStrategy, type ReviewRule } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Strategy } from '@/types/domain';
import { formatClock, parseClock } from '@/utils/dates';
import { money, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const STYLE_LABEL = { scalp: 'Scalp', intraday: 'Intraday', swing: 'Swing' } as const;

/** Review & edit measurable rules — after AI conversion, generation, or for a saved strategy. */
export default function ReviewStrategy() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const saved = useAppStore((s) => s.strategies.find((x) => x.id === id) ?? null);
  const draft = useStrategyDraftStore((s) => s.draft);
  const origin = useStrategyDraftStore((s) => s.origin);
  const source = useStrategyDraftStore((s) => s.source);
  const rules = useAppStore((s) => s.tradingRules);
  const profile = useAppStore((s) => s.preferences.tradingProfile);
  const upsert = useAppStore((s) => s.upsertStrategy);
  const setActive = useAppStore((s) => s.setActiveStrategy);
  const activeId = useAppStore((s) => s.activeStrategyId);

  const [s, setS] = useState<Strategy | null>(() => saved ?? draft);
  // What the strategy looked like before editing — a changed built-in becomes AI_ADAPTED.
  const [baseline] = useState<Strategy | null>(() => saved ?? draft);
  const [editing, setEditing] = useState<ReviewRule | 'name' | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [newCondition, setNewCondition] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  if (!s) {
    return (
      <Screen header={<AppHeader title="Review strategy" back />}>
        <EmptyState icon="git-branch-outline" title="No strategy to review" message="Describe your strategy or pick a template first." actionLabel="Describe my strategy" onAction={() => router.replace('/strategy/describe')} />
      </Screen>
    );
  }

  const ruleList = strategyRules(s);
  const isSaved = !!saved;

  const openEdit = (r: ReviewRule | 'name') => {
    setEditing(r);
    if (r === 'name') return setV1(s.name);
    if (r.kind === 'window') {
      setV1(s.entryWindowStart ?? '');
      setV2(s.entryWindowEnd ?? '');
    } else if (r.kind === 'condition') setV1(r.label);
    else if (r.kind === 'stop') setV1(String(s.typicalStopMax ?? ''));
    else if (r.kind === 'rr') setV1(String(s.minRR));
    else if (r.kind === 'maxTrades') setV1(String(s.maxTrades));
    else if (r.kind === 'bias') setV1(s.biasRequirement);
  };

  const applyEdit = () => {
    if (!editing) return;
    if (editing === 'name') setS({ ...s, name: v1.trim() || s.name });
    else if (editing.kind === 'window') {
      if (parseClock(v1) == null || parseClock(v2) == null) return;
      setS({ ...s, entryWindowStart: v1.trim().padStart(5, '0'), entryWindowEnd: v2.trim().padStart(5, '0') });
    } else if (editing.kind === 'condition') {
      setS({ ...s, checklist: s.checklist.map((c) => (c.id === editing.itemId ? { ...c, label: v1.trim() || c.label } : c)) });
    } else if (editing.kind === 'stop') setS({ ...s, typicalStopMax: parseNum(v1) });
    else if (editing.kind === 'rr') setS({ ...s, minRR: Math.max(0.5, parseNum(v1) ?? s.minRR) });
    else if (editing.kind === 'maxTrades') setS({ ...s, maxTrades: Math.max(1, Math.round(parseNum(v1) ?? s.maxTrades)) });
    else if (editing.kind === 'bias') setS({ ...s, biasRequirement: v1.trim() });
    setEditing(null);
  };

  const remove = (r: ReviewRule) => {
    if (r.kind === 'window') setS({ ...s, entryWindowStart: null, entryWindowEnd: null });
    else if (r.kind === 'condition') setS({ ...s, checklist: s.checklist.filter((c) => c.id !== r.itemId) });
    else if (r.kind === 'stop') setS({ ...s, typicalStopMax: null, typicalStopMin: null });
    else if (r.kind === 'bias') setS({ ...s, requiresBiasAlignment: false });
  };

  const addCondition = () => {
    const label = newCondition.trim();
    if (!label) return;
    setS({ ...s, checklist: [...s.checklist, { id: `c_${uuid().slice(0, 8)}`, label, kind: 'yesno', required: true }] });
    setNewCondition('');
  };

  const save = (advanced = false) => {
    const next = { ...s, updatedAt: new Date().toISOString() };
    next.sourceType = sourceTypeAfterEdit(baseline, next);
    const problems = validateStrategy(next);
    setErrors(problems);
    if (problems.length) return;
    upsert(next);
    if (!isSaved || !activeId) setActive(next.id);
    useStrategyDraftStore.getState().setDraft(null);
    if (advanced) router.replace({ pathname: '/strategy/[id]', params: { id: next.id } });
    else if (isSaved) router.back();
    else router.replace({ pathname: '/strategy/next', params: { id: next.id } });
  };

  return (
    <Screen
      header={<AppHeader title={isSaved ? 'Strategy rules' : 'Review & edit'} back />}
      footer={
        <View style={styles.footer}>
          <Button label="Edit Plan" variant="secondary" size="md" style={styles.flex} onPress={() => save(true)} />
          <Button label={isSaved ? 'Save Changes' : 'Save Strategy'} size="md" style={styles.flex} onPress={() => save(false)} />
        </View>
      }>
      {!isSaved ? (
        <View style={{ gap: spacing.xs }}>
          <AppText variant="title">Your custom trading plan</AppText>
          <AppText variant="body" tone="secondary">
            {origin === 'build'
              ? "Here's a structured starter strategy based on your preferences and risk limits."
              : `Here are the measurable rules ${source === 'ai' ? 'AI' : 'Prop Guard'} extracted from your description. Edit anything that isn't exactly right.`}
          </AppText>
        </View>
      ) : null}

      <Card>
        <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${s.name}`} onPress={() => openEdit('name')} style={styles.nameRow}>
          <AppText variant="title" style={styles.flex} numberOfLines={1}>
            {s.name}
          </AppText>
          <Ionicons name="pencil" size={16} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.badgeRow}>
          <StatusBadge
            label={strategySourceLabel({ ...s, sourceType: sourceTypeAfterEdit(baseline, s) })}
            tone={strategySourceType(s) === 'CUSTOM' ? 'warning' : 'accent'}
            size="sm"
          />
          {origin === 'build' && !isSaved ? <StatusBadge label="Starter plan" tone="positive" size="sm" /> : null}
        </View>
        <DetailTable
          rows={[
            { label: 'Instrument', value: s.markets.join(', ') },
            { label: 'Trading window', value: s.entryWindowStart && s.entryWindowEnd ? `${formatClock(s.entryWindowStart)} – ${formatClock(s.entryWindowEnd)}` : 'Any time' },
            { label: 'Trading style', value: STYLE_LABEL[profile.style] },
            { label: 'Max risk / trade', value: money(rules.maxRiskPerTrade) },
            { label: 'Daily stop', value: money(rules.dailyStop) },
            { label: 'Max trades', value: String(s.maxTrades) },
          ]}
        />
      </Card>

      <SectionHeader title="Entry conditions" />
      <Card>
        {ruleList.map((r, i) => (
          <View key={r.id} style={[styles.rule, i > 0 && styles.border]}>
            <View style={styles.num}>
              <AppText variant="caption" style={{ color: colors.text, fontWeight: '700' }}>
                {i + 1}
              </AppText>
            </View>
            <AppText variant="body" style={styles.flex}>
              {r.label}
            </AppText>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit rule: ${r.label}`} hitSlop={8} onPress={() => openEdit(r)} style={styles.iconBtn}>
              <Ionicons name="create-outline" size={18} color={colors.accentBright} />
            </Pressable>
            {r.deletable ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete rule: ${r.label}`} hitSlop={8} onPress={() => remove(r)} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            ) : (
              <View style={styles.iconBtn} />
            )}
          </View>
        ))}
        <View style={styles.add}>
          <View style={styles.flex}>
            <Input value={newCondition} onChangeText={setNewCondition} placeholder="Add a condition, e.g. Volume above average" onSubmitEditing={addCondition} returnKeyType="done" />
          </View>
          <Button label="Add" size="md" variant="secondary" icon="add" onPress={addCondition} />
        </View>
      </Card>

      {errors.length > 0 ? (
        <Card tone="danger">
          {errors.map((e) => (
            <AppText key={e} variant="body" tone="danger">
              • {e}
            </AppText>
          ))}
        </Card>
      ) : null}

      {s.notes && origin === 'describe' ? (
        <Card>
          <AppText variant="label">Your description</AppText>
          <AppText variant="caption" style={{ marginTop: spacing.sm }}>
            {s.notes}
          </AppText>
        </Card>
      ) : null}

      <Sheet visible={editing != null} onClose={() => setEditing(null)} title={editing === 'name' ? 'Strategy name' : 'Edit rule'}>
        {editing === 'name' || (editing && (editing.kind === 'condition' || editing.kind === 'bias')) ? (
          <Input label={editing === 'name' ? 'Name' : editing.kind === 'bias' ? 'Bias timeframe' : 'Condition'} value={v1} onChangeText={setV1} autoFocus />
        ) : null}
        {editing && editing !== 'name' && editing.kind === 'window' ? (
          <View style={styles.footer}>
            <View style={styles.flex}>
              <Input label="Start (ET, HH:mm)" value={v1} onChangeText={setV1} keyboardType="numbers-and-punctuation" error={v1 && parseClock(v1) == null ? 'Use HH:mm' : null} />
            </View>
            <View style={styles.flex}>
              <Input label="End (ET, HH:mm)" value={v2} onChangeText={setV2} keyboardType="numbers-and-punctuation" error={v2 && parseClock(v2) == null ? 'Use HH:mm' : null} />
            </View>
          </View>
        ) : null}
        {editing && editing !== 'name' && (editing.kind === 'stop' || editing.kind === 'rr' || editing.kind === 'maxTrades') ? (
          <NumericInput
            label={editing.kind === 'stop' ? 'Max stop (points)' : editing.kind === 'rr' ? 'Minimum R (1 : x)' : 'Max trades per day'}
            value={v1}
            onChangeText={setV1}
            autoFocus
            large
          />
        ) : null}
        <Button label="Save rule" onPress={applyEdit} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
});
