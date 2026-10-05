import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, CircularScore, Input, Sheet, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import {
  CONFIDENCE_LABELS,
  joinCriteria,
  type ResolveInput,
  type ResolveProgress,
  type RuleProvenance,
  type RuleSource,
  type StrategyHealthScore,
  type StrategyOwnership,
  type StrategyRuleItem,
  type TestReadiness,
} from '@/lib/engines/strategyIntelligence';
import { parseNum } from '@/utils/format';

// ───────────────────────────── Origin labels (one vocabulary everywhere) ─────────────────────────────

export function originBadge(provenance: RuleProvenance | 'account', origin?: RuleSource): { label: string; tone: Tone } {
  if (origin === 'custom') return { label: 'Custom rule · resolved ✓', tone: 'positive' };
  if (origin === 'ai_approved') return { label: 'AI suggestion — approved ✓', tone: 'accent' };
  if (provenance === 'trader') return { label: 'Your rule', tone: 'positive' };
  if (provenance === 'inferred') return { label: 'AI interpretation', tone: 'accent' };
  if (provenance === 'account') return { label: 'Account rule', tone: 'neutral' };
  return { label: 'AI suggestion', tone: 'accent' };
}

export function ItemStatusBadge({ item }: { item: StrategyRuleItem }) {
  if (item.resolved) return <StatusBadge label="Resolved ✓" tone="positive" size="sm" />;
  if (item.critical) return <StatusBadge label="Critical rule missing" tone="danger" icon="alert-circle" size="sm" />;
  if (item.subjective) return <StatusBadge label="Subjective rule" tone="warning" icon="help-circle-outline" size="sm" />;
  return <StatusBadge label={item.required ? 'Not stated' : 'Optional'} tone={item.required ? 'warning' : 'neutral'} size="sm" />;
}

// ───────────────────────────── Score ─────────────────────────────

const scoreTone = (n: number): Tone => (n >= 75 ? 'positive' : n >= 50 ? 'accent' : n >= 30 ? 'warning' : 'danger');

/** STRATEGY DEFINITION SCORE — how completely and testably the plan is defined (never profitability). */
export function DefinitionScoreCard({ baseline, current }: { baseline: StrategyHealthScore; current: StrategyHealthScore }) {
  const changed = current.total !== baseline.total;
  const deltas = current.dimensions
    .map((d) => ({ label: d.label, delta: d.score - (baseline.dimensions.find((b) => b.key === d.key)?.score ?? d.score) }))
    .filter((d) => d.delta !== 0)
    .sort((a, b) => b.delta - a.delta);
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="pulse-outline" size={16} color={colors.accentBright} />
        <AppText variant="label" tone="accent">
          Strategy definition score
        </AppText>
      </View>
      <View style={[styles.row, { marginTop: spacing.md, gap: spacing.lg }]}>
        <CircularScore value={current.total} tone={scoreTone(current.total)} size={108} label="/ 100" />
        <View style={styles.flex}>
          <AppText variant="heading" accessibilityLabel={`Definition score ${current.total} out of 100${changed ? `, up from ${baseline.total}` : ''}`}>
            {changed ? `${baseline.total} → ${current.total}` : `${current.total} / 100`}
          </AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            This score measures how clearly your strategy is defined — not whether it makes money.
          </AppText>
        </View>
      </View>
      {deltas.length ? (
        <View style={[styles.wrap, { marginTop: spacing.md }]}>
          {deltas.slice(0, 6).map((d) => (
            <StatusBadge key={d.label} label={`${d.delta > 0 ? '+' : ''}${d.delta} ${d.label}`} tone={d.delta > 0 ? 'positive' : 'warning'} size="sm" />
          ))}
        </View>
      ) : null}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {current.dimensions.map((d) => (
          <View key={d.key} style={styles.dimRow}>
            <AppText variant="caption" style={styles.dimLabel}>
              {d.label}
            </AppText>
            <View style={styles.bar}>
              <View style={[styles.fill, { width: `${d.score}%`, backgroundColor: d.score >= 70 ? colors.positive : d.score >= 40 ? colors.warning : colors.danger }]} />
            </View>
            <AppText variant="caption" style={styles.dimVal}>
              {d.score}
            </AppText>
          </View>
        ))}
      </View>
    </Card>
  );
}

// ───────────────────────────── Summary + progress ─────────────────────────────

export function ResolveSummaryCard({ progress, onResolveNext, onViewAll, onFinishLater }: { progress: ResolveProgress; onResolveNext: () => void; onViewAll: () => void; onFinishLater?: () => void }) {
  const open = progress.total - progress.resolved;
  const pct = progress.total ? progress.resolved / progress.total : 1;
  return (
    <Card tone={progress.criticalOpen.length ? 'danger' : open ? 'warning' : 'positive'}>
      <View style={styles.row}>
        <Ionicons name={open ? 'construct-outline' : 'checkmark-circle'} size={18} color={open ? colors.warning : colors.positive} />
        <AppText variant="label" tone={open ? 'warning' : 'positive'}>
          Resolve missing rules
        </AppText>
      </View>
      <AppText variant="heading" style={{ marginTop: spacing.sm }}>
        {open ? `⚠ ${open} rule${open === 1 ? '' : 's'} still need${open === 1 ? 's' : ''} a definition` : 'All required rules are defined'}
      </AppText>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Strategy completion · {progress.resolved} / {progress.total} rules resolved
      </AppText>
      <View style={[styles.progress, { marginTop: spacing.sm }]} accessibilityLabel={`${progress.resolved} of ${progress.total} rules resolved`}>
        <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
      </View>
      {progress.criticalOpen.length ? (
        <View style={[styles.row, { marginTop: spacing.sm }]}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <AppText variant="bodyStrong" tone="danger">
            Critical rule missing: {progress.criticalOpen.map((i) => i.title).join(', ')}
          </AppText>
        </View>
      ) : null}
      {progress.next ? (
        <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
          Next unresolved rule: <AppText variant="bodyStrong">{progress.next.title}</AppText>
        </AppText>
      ) : null}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {progress.next ? <Button label={progress.resolved ? 'Resolve next rule' : 'Resolve rules'} icon="arrow-forward" onPress={onResolveNext} /> : null}
        <View style={styles.btnRow}>
          <Button label="View all missing rules" size="md" variant="secondary" style={styles.flex} onPress={onViewAll} />
          {onFinishLater && open ? <Button label="Finish later" size="md" variant="ghost" style={styles.flex} onPress={onFinishLater} /> : null}
        </View>
      </View>
    </Card>
  );
}

/** Every rule item in priority order (progressive disclosure: optional ones collapsed). */
export function ResolveList({ items, onOpen }: { items: StrategyRuleItem[]; onOpen: (item: StrategyRuleItem) => void }) {
  const [showOptional, setShowOptional] = useState(false);
  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);
  const row = (i: StrategyRuleItem) => (
    <Pressable key={i.id} accessibilityRole="button" accessibilityLabel={`${i.title}: ${i.resolved ? 'resolved' : 'not defined'}. Open`} onPress={() => onOpen(i)} style={styles.listRow}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong">{i.title}</AppText>
        <AppText variant="caption" numberOfLines={2} style={{ marginTop: 2 }}>
          {i.resolved ? i.normalizedRule : i.originalText ? `You wrote: “${i.originalText}”` : i.why}
        </AppText>
        <View style={{ marginTop: 4, alignItems: 'flex-start' }}>
          <ItemStatusBadge item={i} />
        </View>
      </View>
      <View style={styles.resolveBtn}>
        <AppText variant="caption" tone={i.resolved ? 'secondary' : 'accent'} style={{ fontWeight: '700' }}>
          {i.resolved ? 'Change' : 'Resolve'}
        </AppText>
      </View>
    </Pressable>
  );
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="list-circle-outline" size={18} color={colors.warning} />
        <AppText variant="label" tone="warning">
          Resolve missing rules
        </AppText>
      </View>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Ordered by importance: entry first, then risk, invalidation, exits, context, time and limits. Prop Guard never adds a rule until you choose it.
      </AppText>
      {required.map(row)}
      {optional.length ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setShowOptional((v) => !v)} style={[styles.row, { marginTop: spacing.md }]}>
            <Ionicons name={showOptional ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            <AppText variant="label">{showOptional ? 'Hide' : 'Show'} optional refinements ({optional.length})</AppText>
          </Pressable>
          {showOptional ? optional.map(row) : null}
        </>
      ) : null}
    </Card>
  );
}

// ───────────────────────────── Resolve sheet (the interview) ─────────────────────────────

type Step = 'choose' | 'confirm' | 'done';

export function ResolveRuleSheet({
  item,
  onClose,
  onResolve,
  onUnresolve,
  progress,
  onNext,
}: {
  item: StrategyRuleItem | null;
  onClose: () => void;
  onResolve: (input: ResolveInput) => void;
  onUnresolve: () => void;
  progress: ResolveProgress;
  onNext: () => void;
}) {
  return (
    <Sheet visible={!!item} onClose={onClose} title="RESOLVE RULE">
      {item ? <ResolveBody key={item.id} item={item} onResolve={onResolve} onUnresolve={onUnresolve} progress={progress} onNext={onNext} onClose={onClose} /> : null}
    </Sheet>
  );
}

function ResolveBody({ item, onResolve, onUnresolve, progress, onNext, onClose }: { item: StrategyRuleItem; onResolve: (input: ResolveInput) => void; onUnresolve: () => void; progress: ResolveProgress; onNext: () => void; onClose: () => void }) {
  const rec = item.aiRecommendation;
  const [step, setStep] = useState<Step>('choose');
  const [showOptions, setShowOptions] = useState(!rec || item.resolved);
  const [selected, setSelected] = useState<string[]>(item.selectedOption ?? []);
  const [custom, setCustom] = useState(item.customValue ?? '');
  const [writing, setWriting] = useState(!!item.customValue);
  const [value, setValue] = useState('');
  const chosen = item.options.filter((o) => selected.includes(o.id));
  const needsInput = chosen.find((o) => o.input)?.input;
  const inputNum = parseNum(value) ?? needsInput?.defaultValue;
  const preview = writing ? custom.trim() : joinCriteria(chosen.map((o) => o.ruleText.replace(/\{v\}/g, inputNum != null ? String(inputNum) : '?')));
  const canContinue = writing ? custom.trim().length >= 3 : chosen.length > 0 && (!needsInput || inputNum != null);
  const recOptions = rec ? item.options.filter((o) => rec.optionIds.includes(o.id)) : [];

  const toggle = (id: string) => {
    setWriting(false);
    setSelected((cur) => (item.multiSelect ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id]));
  };

  if (step === 'done') {
    const left = progress.total - progress.resolved;
    return (
      <View style={{ gap: spacing.md }}>
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={22} color={colors.positive} />
          <AppText variant="heading">Rule resolved ✓</AppText>
        </View>
        <AppText variant="body" tone="secondary">
          {progress.resolved} / {progress.total} rules resolved{left ? ` · ${left} to go` : ' — every required rule is defined'}.
        </AppText>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${progress.total ? Math.round((progress.resolved / progress.total) * 100) : 100}%` }]} />
        </View>
        {progress.next ? <Button label={`Resolve next rule: ${progress.next.title}`} icon="arrow-forward" onPress={onNext} /> : null}
        <Button label={progress.next ? 'Finish later' : 'Done'} variant="secondary" onPress={onClose} />
      </View>
    );
  }

  if (step === 'confirm') {
    return (
      <View style={{ gap: spacing.md }}>
        <AppText variant="label" tone="positive">
          RESOLVED RULE · {item.title}
        </AppText>
        <View style={styles.resolvedBox}>
          <AppText variant="body">{preview}</AppText>
        </View>
        <StatusBadge label={writing ? 'Custom rule — your definition' : 'AI suggestion — approved by you'} tone={writing ? 'positive' : 'accent'} size="sm" />
        {!writing && chosen.some((o) => o.confidence === 'D') ? (
          <AppText variant="caption" tone="warning">
            {CONFIDENCE_LABELS.D}. The threshold is a starting point — adjust it to what you actually see on your charts.
          </AppText>
        ) : null}
        <AppText variant="caption">This rule becomes part of your strategy only when you approve it.</AppText>
        <Button
          label="Approve rule"
          icon="checkmark"
          onPress={() => {
            onResolve(writing ? { optionIds: [], customText: custom } : { optionIds: selected, inputValue: needsInput ? inputNum : undefined });
            setStep('done');
          }}
        />
        <Button label="Back" variant="ghost" onPress={() => setStep('choose')} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={[styles.row, styles.wrap]}>
        <AppText variant="title" style={styles.flex}>
          {item.title}
        </AppText>
        <ItemStatusBadge item={item} />
      </View>
      {item.subjective && item.originalText ? (
        <View style={styles.subjectiveBox}>
          <AppText variant="label" tone="warning">
            SUBJECTIVE RULE
          </AppText>
          <AppText variant="body" style={{ marginTop: 4, fontStyle: 'italic' }}>
            Your rule: “{item.originalText}”
          </AppText>
        </View>
      ) : null}
      <AppText variant="body" tone="secondary">
        {item.why}
      </AppText>

      {rec && !showOptions ? (
        <View style={styles.recBox}>
          <View style={[styles.row, styles.wrap]}>
            <AppText variant="label" tone="accent">
              PROP GUARD RECOMMENDS
            </AppText>
            <StatusBadge label="AI suggestion" tone="accent" icon="sparkles" size="sm" />
          </View>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            {recOptions.map((o) => o.label).join(' + ')}
          </AppText>
          <AppText variant="caption" style={{ marginTop: 2 }}>
            {joinCriteria(recOptions.map((o) => o.ruleText.replace(/\{v\}/g, String(o.input?.defaultValue ?? '?'))))}
          </AppText>
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            Why: {rec.reasoning}
          </AppText>
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            <Button
              label="Use this rule"
              icon="checkmark"
              onPress={() => {
                setSelected(rec.optionIds);
                setWriting(false);
                setStep('confirm');
              }}
            />
            <View style={styles.btnRow}>
              <Button label="Show other options" size="md" variant="secondary" style={styles.flex} onPress={() => setShowOptions(true)} />
              <Button
                label="Write my own"
                size="md"
                variant="secondary"
                style={styles.flex}
                onPress={() => {
                  setShowOptions(true);
                  setWriting(true);
                }}
              />
            </View>
          </View>
        </View>
      ) : (
        <>
          <AppText variant="label">{item.question}</AppText>
          {item.multiSelect ? <AppText variant="caption">Choose one or more — they combine with AND.</AppText> : null}
          {item.options.map((o) => {
            const on = selected.includes(o.id) && !writing;
            const isRec = rec?.optionIds.includes(o.id);
            return (
              <Pressable key={o.id} accessibilityRole={item.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} accessibilityLabel={o.label} onPress={() => toggle(o.id)} style={[styles.option, on && styles.optionOn]}>
                <Ionicons name={item.multiSelect ? (on ? 'checkbox' : 'square-outline') : on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.accentBright : colors.textTertiary} />
                <View style={styles.flex}>
                  <View style={[styles.row, styles.wrap]}>
                    <AppText variant="bodyStrong">{o.label}</AppText>
                    {isRec ? <StatusBadge label="Recommended" tone="accent" size="sm" /> : null}
                  </View>
                  <AppText variant="caption" style={{ marginTop: 2 }}>
                    {o.detail}
                  </AppText>
                  {o.tradeoff ? (
                    <AppText variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
                      Trade-off: {o.tradeoff}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {needsInput && !writing ? (
            <Input label={`${needsInput.label} (${needsInput.unit})`} value={value} onChangeText={setValue} placeholder={needsInput.placeholder} keyboardType="decimal-pad" hint="Examples are not recommendations — use the value that fits how you trade." />
          ) : null}
          {rec ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Let Prop Guard recommend one" onPress={() => setShowOptions(false)} style={styles.option}>
              <Ionicons name="sparkles-outline" size={20} color={colors.accentBright} />
              <View style={styles.flex}>
                <AppText variant="bodyStrong">Let Prop Guard recommend one</AppText>
                <AppText variant="caption">See the suggestion and why — nothing is added until you approve it</AppText>
              </View>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: writing }} accessibilityLabel="Custom rule" onPress={() => setWriting(true)} style={[styles.option, writing && styles.optionOn]}>
            <Ionicons name={writing ? 'radio-button-on' : 'radio-button-off'} size={20} color={writing ? colors.accentBright : colors.textTertiary} />
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Custom rule</AppText>
              <AppText variant="caption">Define it in your own words</AppText>
            </View>
          </Pressable>
          {writing ? <Input label="Your rule" value={custom} onChangeText={setCustom} multiline placeholder="Write the rule exactly as you would apply it" inputStyle={{ minHeight: 72 }} /> : null}
          <Button label="Continue" icon="arrow-forward" disabled={!canContinue} onPress={() => setStep('confirm')} />
        </>
      )}
      {item.status === 'resolved' ? (
        <Button
          label="Clear this resolution"
          variant="ghost"
          size="md"
          onPress={() => {
            onUnresolve();
            onClose();
          }}
        />
      ) : null}
    </View>
  );
}

// ───────────────────────────── Ownership + test ready ─────────────────────────────

export function OwnershipCard({ ownership, uniquenessNote }: { ownership: StrategyOwnership; uniquenessNote?: string }) {
  const bars: { label: string; pct: number; color: string }[] = [
    { label: 'Original trader rules', pct: ownership.traderPct, color: colors.positive },
    { label: 'AI-assisted rules approved by you', pct: ownership.aiApprovedPct, color: colors.accentBright },
    { label: 'Prop Guard wording / interpretation', pct: ownership.propGuardPct, color: colors.textTertiary },
  ];
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="person-circle-outline" size={18} color={colors.positive} />
        <AppText variant="label" tone="positive">
          Strategy ownership
        </AppText>
      </View>
      <View style={[styles.stack, { marginTop: spacing.sm }]}>
        {bars.map((b) => (b.pct > 0 ? <View key={b.label} style={{ flex: b.pct, backgroundColor: b.color }} /> : null))}
      </View>
      {bars.map((b) => (
        <View key={b.label} style={[styles.row, { marginTop: 6 }]}>
          <View style={[styles.dot, { backgroundColor: b.color }]} />
          <AppText variant="body" style={styles.flex}>
            {b.label}
          </AppText>
          <AppText variant="bodyStrong">{b.pct}%</AppText>
        </View>
      ))}
      <AppText variant="caption" style={{ marginTop: spacing.sm }}>
        Every AI-assisted rule was chosen and approved by you{ownership.customRules ? `; ${ownership.customRules} rule${ownership.customRules === 1 ? ' is' : 's are'} written in your own words` : ''}. Prop Guard did not add anything you did not approve.
      </AppText>
      {uniquenessNote ? (
        <AppText variant="caption" tone="tertiary" style={{ marginTop: 4 }}>
          Identity check: {uniquenessNote}
        </AppText>
      ) : null}
    </Card>
  );
}

export function TestReadyCard({ readiness, score, onViewFinal, onTest }: { readiness: TestReadiness; score: number; onViewFinal: () => void; onTest: () => void }) {
  return (
    <Card tone="positive">
      <View style={styles.row}>
        <Ionicons name="shield-checkmark" size={20} color={colors.positive} />
        <AppText variant="heading" tone="positive">
          STRATEGY TEST READY ✓
        </AppText>
      </View>
      <AppText variant="body" style={{ marginTop: spacing.xs }}>
        Definition score: {score}/100 · rules are measurable and ready for historical practice.
      </AppText>
      <AppText variant="label" style={{ marginTop: spacing.md }}>
        Core rules defined
      </AppText>
      <View style={[styles.wrap, { marginTop: 4 }]}>
        {readiness.core.map((c) => (
          <AppText key={c.label} variant="body" style={{ minWidth: '45%' }}>
            {c.done ? '✓' : '○'} {c.label}
          </AppText>
        ))}
      </View>
      {readiness.optionalOpen.length ? (
        <AppText variant="caption" style={{ marginTop: spacing.sm }}>
          Remaining optional: {readiness.optionalOpen.join(', ')}
        </AppText>
      ) : null}
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        <Button label="View final strategy" icon="document-text-outline" onPress={onViewFinal} />
        <Button label="Test in historical practice" icon="time-outline" variant="secondary" onPress={onTest} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  dimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dimLabel: { width: 132 },
  dimVal: { width: 32, textAlign: 'right' },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  progress: { height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.positive },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.xs },
  resolveBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  subjectiveBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningMuted, borderLeftWidth: 3, borderLeftColor: colors.warning },
  recBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentMuted, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent },
  resolvedBox: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.positive },
  option: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  optionOn: { borderColor: colors.accentBright, backgroundColor: colors.accentMuted },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
