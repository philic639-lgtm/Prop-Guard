import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Chip, CircularScore, Input, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import {
  CONFIDENCE_LABELS,
  provenanceLabel,
  type ConfidenceLabel,
  type BehavioralRisk,
  type ChecklistSection,
  type ClarifyingQuestion,
  type StrategyHealthScore,
  type StrategySuggestion,
  type StructuredStrategy,
} from '@/lib/engines/strategyIntelligence';

export const ANALYSIS_STEPS = [
  'Understanding your edge',
  'Finding vague rules',
  'Checking risk structure',
  'Looking for behavioral weaknesses',
  'Making rules measurable',
  'Building your PropGuard strategy',
];

/** "Analyzing your plan…" — six stages, each ticked as it completes. */
export function AnalysisProgress({ step }: { step: number }) {
  return (
    <Card>
      <AppText variant="heading">Analyzing your plan…</AppText>
      <View style={{ marginTop: spacing.md, gap: spacing.md }}>
        {ANALYSIS_STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <View key={label} style={styles.row} accessibilityLabel={`${i + 1}. ${label}${done ? ', done' : active ? ', in progress' : ''}`}>
              <View style={[styles.stepDot, done && { backgroundColor: colors.positive, borderColor: colors.positive }, active && { borderColor: colors.accentBright }]}>
                {done ? <Ionicons name="checkmark" size={13} color="#03140A" /> : active ? <ActivityIndicator size="small" color={colors.accentBright} /> : <AppText variant="caption">{i + 1}</AppText>}
              </View>
              <AppText variant="body" tone={done || active ? 'primary' : 'tertiary'}>
                {label}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function SectionTitle({ children, icon, tone = 'accent' }: { children: string; icon: keyof typeof Ionicons.glyphMap; tone?: 'accent' | 'positive' | 'warning' | 'danger' }) {
  const c = tone === 'positive' ? colors.positive : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : colors.accentBright;
  return (
    <View style={[styles.row, { marginTop: spacing.sm }]}>
      <Ionicons name={icon} size={16} color={c} />
      <AppText variant="label" style={{ color: c }}>
        {children}
      </AppText>
    </View>
  );
}

/** YOUR IDEA — the trader's words, untouched, plus how Prop Guard classified them. */
export function IdeaCard({ a }: { a: StructuredStrategy }) {
  return (
    <Card>
      <SectionTitle icon="chatbubble-ellipses-outline">Your idea</SectionTitle>
      <View style={styles.quote}>
        <AppText variant="body" style={{ fontStyle: 'italic' }}>
          “{a.originalText.trim()}”
        </AppText>
      </View>
      <AppText variant="label" style={{ marginTop: spacing.md }}>
        Prop Guard reads this as
      </AppText>
      <AppText variant="heading" style={{ marginTop: 2 }}>
        {a.classification}
      </AppText>
      <View style={[styles.wrap, { marginTop: spacing.sm }]}>
        {a.detectedStyle.slice(0, 5).map((s) => (
          <StatusBadge key={s.id} label={s.label} tone={s.id === 'custom' ? 'warning' : 'accent'} size="sm" />
        ))}
        {a.direction ? <StatusBadge label={a.direction === 'both' ? 'Both directions' : a.direction === 'long' ? 'Long' : 'Short'} size="sm" /> : null}
        {a.instrument.map((i) => (
          <StatusBadge key={i} label={i} size="sm" />
        ))}
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.sm }}>
        {a.analysisSource === 'ai' ? 'Interpreted by Prop Guard AI and checked by Prop Guard’s rule engine.' : 'Interpreted on-device by Prop Guard’s rule engine.'} Strategy types are not limited to a preset list.
      </AppText>
    </Card>
  );
}

const scoreTone = (n: number): Tone => (n >= 75 ? 'positive' : n >= 50 ? 'accent' : n >= 30 ? 'warning' : 'danger');

export function HealthCard({ health, improved }: { health: StrategyHealthScore; improved: StrategyHealthScore }) {
  const delta = improved.total - health.total;
  return (
    <Card>
      <SectionTitle icon="pulse-outline">Strategy health score</SectionTitle>
      <View style={[styles.row, { marginTop: spacing.md, gap: spacing.lg }]}>
        <CircularScore value={health.total} tone={scoreTone(health.total)} size={112} label="/ 100" />
        <View style={styles.flex}>
          <AppText variant="heading">STRATEGY HEALTH: {health.total}/100</AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            Measures how clearly the plan is defined — not whether it makes money.
          </AppText>
          {delta > 0 ? (
            <View style={{ marginTop: spacing.sm }}>
              <StatusBadge label={`${improved.total}/100 with accepted suggestions`} tone="positive" icon="trending-up" size="sm" />
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {health.dimensions.map((d) => {
          const after = improved.dimensions.find((x) => x.key === d.key)?.score ?? d.score;
          return (
            <View key={d.key} style={styles.dimRow} accessibilityLabel={`${d.label} ${d.score} of 100${after !== d.score ? `, ${after} with accepted suggestions` : ''}`}>
              <AppText variant="caption" style={styles.dimLabel}>
                {d.label}
              </AppText>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${after}%`, backgroundColor: colors.positive, opacity: after > d.score ? 0.35 : 0 }]} />
                <View style={[styles.fill, styles.abs, { width: `${d.score}%`, backgroundColor: d.score >= 70 ? colors.positive : d.score >= 40 ? colors.warning : colors.danger }]} />
              </View>
              <AppText variant="caption" style={styles.dimVal}>
                {after !== d.score ? `${d.score}→${after}` : d.score}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function Line({ icon, color, text }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string }) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 2 }} />
      <AppText variant="body" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export function StrongCard({ health }: { health: StrategyHealthScore }) {
  return (
    <Card tone="positive">
      <SectionTitle icon="checkmark-circle-outline" tone="positive">
        What’s strong
      </SectionTitle>
      {(health.strengths.length ? health.strengths : ['You wrote the plan down — that is the starting point for every rule below.']).map((s) => (
        <Line key={s} icon="checkmark" color={colors.positive} text={s} />
      ))}
    </Card>
  );
}

export function NeedsWorkCard({ health }: { health: StrategyHealthScore }) {
  return (
    <Card tone={health.criticalGaps.length ? 'danger' : 'warning'}>
      <SectionTitle icon="construct-outline" tone="warning">
        What needs work
      </SectionTitle>
      {health.weaknesses.map((s) => (
        <Line key={s} icon="warning-outline" color={colors.warning} text={s} />
      ))}
      {health.criticalGaps.length ? (
        <>
          <AppText variant="label" tone="danger" style={{ marginTop: spacing.md }}>
            Critical gaps
          </AppText>
          {health.criticalGaps.map((s) => (
            <Line key={s} icon="close-circle" color={colors.danger} text={s} />
          ))}
        </>
      ) : null}
    </Card>
  );
}

const SEVERITY_TONE: Record<BehavioralRisk['severity'], Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };

export function BehaviorCard({ risks }: { risks: BehavioralRisk[] }) {
  return (
    <Card>
      <SectionTitle icon="git-network-outline" tone="warning">
        Behavioral risk
      </SectionTitle>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Behaviors the written plan could encourage — this is about the rules, not about you.
      </AppText>
      {risks.length === 0 ? <Line icon="shield-checkmark-outline" color={colors.positive} text="No behavioral weaknesses found in how the plan is written." /> : null}
      {risks.map((r, i) => (
        <View key={r.id} style={[styles.block, i > 0 && styles.border]}>
          <View style={styles.row}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {r.title}
            </AppText>
            <StatusBadge label={r.severity} tone={SEVERITY_TONE[r.severity]} size="sm" />
          </View>
          <AppText variant="body" tone="secondary" style={{ marginTop: 4 }}>
            {r.explanation}
          </AppText>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            Guard-rail: {r.mitigation}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

/** One AI suggestion with ACCEPT / EDIT / REJECT. Thresholds are always labelled as Prop Guard's. */
export function SuggestionCard({ s, onDecide }: { s: StrategySuggestion; onDecide: (status: StrategySuggestion['status'], edited?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.editedText ?? s.suggestedRule);
  const decided = s.status !== 'pending';
  const statusTone: Tone = s.status === 'rejected' ? 'neutral' : s.status === 'pending' ? 'accent' : 'positive';
  return (
    <Card style={s.status === 'rejected' ? { opacity: 0.6 } : undefined}>
      <View style={[styles.row, styles.wrap]}>
        <StatusBadge label="AI suggestion" tone="accent" icon="sparkles" size="sm" />
        <ConfidenceBadge label={s.confidence} />
        {decided ? <StatusBadge label={s.status === 'edited' ? 'Edited' : s.status === 'accepted' ? 'Accepted' : 'Rejected'} tone={statusTone} size="sm" /> : null}
      </View>
      <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
        {s.title}
      </AppText>
      <FlowStep label="Original idea">
        <AppText variant="body" style={s.original ? { fontStyle: 'italic' } : undefined} tone={s.original ? 'primary' : 'tertiary'}>
          {s.original ? `“${s.original}”` : 'Not stated in your plan'}
        </AppText>
      </FlowStep>
      <FlowStep label="Problem identified">
        <AppText variant="body" tone="secondary">
          {s.issue}
        </AppText>
      </FlowStep>
      {editing ? (
        <View style={{ marginTop: spacing.sm }}>
          <Input label="Your version of this rule" value={draft} onChangeText={setDraft} multiline inputStyle={{ minHeight: 72 }} />
          <View style={[styles.btnRow, { marginTop: spacing.sm }]}>
            <Button label="Cancel" size="md" variant="secondary" style={styles.flex} onPress={() => setEditing(false)} />
            <Button
              label="Save edit"
              size="md"
              icon="checkmark"
              style={styles.flex}
              disabled={!draft.trim()}
              onPress={() => {
                onDecide('edited', draft);
                setEditing(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={[styles.suggested, { marginTop: spacing.sm }]}>
          <AppText variant="caption" tone="accent">
            {s.status === 'edited' ? 'Your edited rule' : 'Prop Guard improvement'}
          </AppText>
          <AppText variant="body">{s.status === 'edited' && s.editedText ? s.editedText : s.suggestedRule}</AppText>
        </View>
      )}
      <FlowStep label="Why the change helps" last>
        <AppText variant="caption">{s.rationale}</AppText>
      </FlowStep>
      {!editing ? (
        <View style={[styles.btnRow, { marginTop: spacing.md }]}>
          <Button label={s.status === 'accepted' ? 'Accepted' : 'Accept'} icon="checkmark" size="md" variant={s.status === 'accepted' ? 'success' : 'secondary'} style={styles.flex} onPress={() => onDecide(s.status === 'accepted' ? 'pending' : 'accepted')} />
          <Button label="Edit" icon="create-outline" size="md" variant={s.status === 'edited' ? 'primary' : 'secondary'} style={styles.flex} onPress={() => setEditing(true)} />
          <Button label={s.status === 'rejected' ? 'Rejected' : 'Reject'} icon="close" size="md" variant={s.status === 'rejected' ? 'danger' : 'secondary'} style={styles.flex} onPress={() => onDecide(s.status === 'rejected' ? 'pending' : 'rejected')} />
        </View>
      ) : null}
    </Card>
  );
}

const CONF_TONE: Record<ConfidenceLabel, Tone> = { A: 'positive', B: 'accent', C: 'neutral', D: 'warning', E: 'positive' };

/** A–E confidence label; D always reads "requires testing". */
export function ConfidenceBadge({ label }: { label: ConfidenceLabel }) {
  return <StatusBadge label={`${label} · ${CONFIDENCE_LABELS[label]}`} tone={CONF_TONE[label]} size="sm" />;
}

function FlowStep({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label.toUpperCase()}
      </AppText>
      <View style={{ marginTop: 2 }}>{children}</View>
      {!last ? <Ionicons name="arrow-down" size={12} color={colors.textTertiary} style={{ marginTop: 4 }} /> : null}
    </View>
  );
}

export function QuestionCard({ q, onAnswer }: { q: ClarifyingQuestion; onAnswer: (answer: string) => void }) {
  const [text, setText] = useState(q.answer ?? '');
  return (
    <Card tone={q.answer ? undefined : 'warning'}>
      <SectionTitle icon="help-circle-outline" tone="warning">
        Prop Guard needs to know
      </SectionTitle>
      <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
        {q.question}
      </AppText>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        {q.why}
      </AppText>
      {q.options?.length ? (
        <View style={[styles.wrap, { marginTop: spacing.sm }]}>
          {q.options.map((o) => (
            <Chip key={o} label={o} selected={q.answer === o} onPress={() => onAnswer(o)} />
          ))}
        </View>
      ) : (
        <View style={[styles.btnRow, { marginTop: spacing.sm, alignItems: 'flex-end' }]}>
          <View style={styles.flex}>
            <Input value={text} onChangeText={setText} placeholder="Your answer" />
          </View>
          <Button label="Save" size="md" variant="secondary" disabled={!text.trim()} onPress={() => onAnswer(text.trim())} />
        </View>
      )}
    </Card>
  );
}

const PROV_TONE: Record<string, Tone> = { trader: 'positive', inferred: 'accent', suggested: 'warning', account: 'neutral' };

/** IMPROVED STRATEGY — every line labelled: your rule / AI interpretation / AI suggestion. */
export function ImprovedStrategyCard({ sections }: { sections: ChecklistSection[] }) {
  return (
    <Card>
      <SectionTitle icon="list-outline">Improved strategy</SectionTitle>
      <View style={[styles.wrap, { marginTop: spacing.sm }]}>
        <StatusBadge label="Your rule" tone="positive" size="sm" />
        <StatusBadge label="AI interpretation" tone="accent" size="sm" />
        <StatusBadge label="AI suggestion" tone="warning" size="sm" />
      </View>
      {sections.map((sec, i) => (
        <View key={sec.key} style={[styles.block, i > 0 && styles.border]}>
          <AppText variant="label">{sec.title.toUpperCase()}</AppText>
          {sec.missing ? (
            <AppText variant="body" tone="tertiary" style={{ marginTop: 4 }}>
              Not defined
            </AppText>
          ) : (
            sec.lines.map((l, k) => (
              <View key={`${sec.key}${k}`} style={[styles.checkLine, l.status === 'rejected' && { opacity: 0.45 }]}>
                <AppText variant="body" style={[styles.flex, l.provenance === 'suggested' && l.status === 'pending' ? { color: colors.textSecondary } : null]}>
                  {l.text}
                </AppText>
                <StatusBadge label={provenanceLabel(l.provenance, l.status)} tone={PROV_TONE[l.provenance]} size="sm" />
              </View>
            ))
          )}
        </View>
      ))}
      <AppText variant="caption" style={{ marginTop: spacing.md }}>
        Pending suggestions are shown for preview and are not saved until you accept or edit them.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  quote: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.accentBright },
  suggested: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentMuted },
  dimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dimLabel: { width: 132 },
  dimVal: { width: 52, textAlign: 'right' },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  abs: { position: 'absolute', left: 0, top: 0 },
  line: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  block: { paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  checkLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 6 },
});
