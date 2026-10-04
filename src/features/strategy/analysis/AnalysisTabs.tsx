import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import {
  provenanceLabel,
  type ChecklistSection,
  type Insight,
  type RegimeAssessment,
  type RiskLevel,
  type StructuredStrategy,
  type TestableRuleSet,
} from '@/lib/engines/strategyIntelligence';

import { BehaviorCard, ConfidenceBadge, NeedsWorkCard, SectionTitle, StrongCard } from './AnalysisCards';

export type AnalyzerTab = 'dna' | 'weaknesses' | 'improved' | 'why' | 'rules' | 'best' | 'avoid' | 'practice';

export const ANALYZER_TABS: { value: AnalyzerTab; label: string }[] = [
  { value: 'dna', label: 'Strategy DNA' },
  { value: 'weaknesses', label: 'Weaknesses' },
  { value: 'improved', label: 'Improved Strategy' },
  { value: 'why', label: 'Why These Changes' },
  { value: 'rules', label: 'Testable Rules' },
  { value: 'best', label: 'Best Market Conditions' },
  { value: 'avoid', label: 'Avoid When' },
  { value: 'practice', label: 'Practice Strategy' },
];

/** Horizontally scrolling tab pills (eight sections do not fit a phone width). */
export function AnalyzerTabBar({ value, onChange }: { value: AnalyzerTab; onChange: (t: AnalyzerTab) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {ANALYZER_TABS.map((t) => {
        const on = t.value === value;
        return (
          <Pressable key={t.value} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} onPress={() => onChange(t.value)} style={[styles.tab, on && styles.tabOn]}>
            <AppText variant="bodyStrong" style={{ fontSize: 13, color: on ? colors.accentOn : colors.textSecondary }}>
              {t.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const PROV_TONE: Record<string, Tone> = { trader: 'positive', inferred: 'accent', suggested: 'warning', account: 'neutral' };

function InsightList({ title, icon, items, tone = 'accent', empty }: { title: string; icon: keyof typeof Ionicons.glyphMap; items: Insight[]; tone?: 'accent' | 'warning' | 'danger' | 'positive'; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <View style={styles.block}>
      <SectionTitle icon={icon} tone={tone}>
        {title}
      </SectionTitle>
      {items.length ? (
        items.map((x) => (
          <View key={x.text} style={styles.insight}>
            <AppText variant="body">{x.text}</AppText>
            <View style={[styles.wrap, { marginTop: 4 }]}>
              <ConfidenceBadge label={x.confidence} />
              {x.basis ? <AppText variant="caption">from “{x.basis}”</AppText> : null}
            </View>
          </View>
        ))
      ) : (
        <AppText variant="caption" style={{ marginTop: 4 }}>
          {empty}
        </AppText>
      )}
    </View>
  );
}

// ───────────────────────────── Strategy DNA ─────────────────────────────

export function DnaTab({ a }: { a: StructuredStrategy }) {
  const r = a.reasoning;
  return (
    <>
      <Card>
        <SectionTitle icon="git-branch-outline">Strategy DNA</SectionTitle>
        <AppText variant="caption" style={{ marginTop: 2 }}>
          Your plan broken into its parts, in your own words. “Not stated” parts are gaps, not things Prop Guard filled in.
        </AppText>
        {a.dna.map((d, i) => (
          <View key={d.key} style={[styles.dnaRow, i > 0 && styles.border]}>
            <AppText variant="label" style={styles.dnaLabel}>
              {d.label}
            </AppText>
            <View style={styles.flex}>
              {d.values.length ? (
                d.values.map((v) => (
                  <View key={v.text} style={styles.dnaValue}>
                    <AppText variant="body">{v.text}</AppText>
                    <StatusBadge label={provenanceLabel(v.provenance)} tone={PROV_TONE[v.provenance]} size="sm" />
                  </View>
                ))
              ) : (
                <AppText variant="body" tone="tertiary">
                  Not stated
                </AppText>
              )}
            </View>
          </View>
        ))}
      </Card>
      <Card>
        <SectionTitle icon="bulb-outline">The idea behind it</SectionTitle>
        <AppText variant="caption" style={{ marginTop: 2 }}>
          What the strategy tries to exploit and what must be true — an analysis of the plan, not of you.
        </AppText>
        <InsightList title="Market behavior it exploits" icon="flash-outline" items={r.exploits} />
        <InsightList title="Assumptions that must hold" icon="help-buoy-outline" items={r.assumptions} />
        <InsightList title="Where false signals occur" icon="alert-circle-outline" items={r.falseSignals} tone="warning" />
        <InsightList title="Entering too early" icon="play-skip-back-outline" items={r.earlyEntry} tone="warning" />
        <InsightList title="Entering too late" icon="play-skip-forward-outline" items={r.lateEntry} tone="warning" />
        <InsightList title="Discretion that is too subjective" icon="eye-outline" items={r.subjectiveDiscretion} tone="warning" />
        <InsightList title="Where overtrading could occur" icon="repeat-outline" items={r.overtrading} tone="warning" />
        <InsightList title="Risk / reward structure" icon="scale-outline" items={r.riskReward} tone="warning" />
        <InsightList title="Regimes that break it" icon="cloudy-night-outline" items={r.regimeThreats} tone="danger" />
      </Card>
    </>
  );
}

// ───────────────────────────── Weaknesses ─────────────────────────────

const RISK_TONE: Record<RiskLevel['level'], Tone> = { low: 'positive', medium: 'warning', high: 'danger' };

function RiskRow({ title, risk }: { title: string; risk: RiskLevel }) {
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {title}
        </AppText>
        <StatusBadge label={risk.level} tone={RISK_TONE[risk.level]} size="sm" />
      </View>
      {risk.reasons.map((x) => (
        <AppText key={x} variant="caption" style={{ marginTop: 2 }}>
          • {x}
        </AppText>
      ))}
    </View>
  );
}

export function WeaknessesTab({ a }: { a: StructuredStrategy }) {
  const w = a.weaknessReport;
  return (
    <>
      <StrongCard health={a.strategyHealthScore} />
      <NeedsWorkCard health={a.strategyHealthScore} />
      <Card>
        <SectionTitle icon="document-text-outline" tone="warning">
          Weakness report
        </SectionTitle>
        <View style={styles.block}>
          <AppText variant="bodyStrong">Missing rules</AppText>
          <AppText variant="body" tone="secondary" style={{ marginTop: 2 }}>
            {w.missingRules.length ? w.missingRules.join(', ') : 'Nothing essential is missing.'}
          </AppText>
        </View>
        <InsightList title="Contradictions" icon="git-compare-outline" items={w.contradictions} tone="danger" empty="No contradictions found." />
        <InsightList title="Ambiguity" icon="help-circle-outline" items={w.ambiguity} tone="warning" empty="No ambiguous wording found." />
        <RiskRow title="Overfitting risk" risk={w.overfittingRisk} />
        <RiskRow title="Execution risk" risk={w.executionRisk} />
        <RiskRow title="Psychological risk (built into the plan)" risk={w.psychologicalRisk} />
        <InsightList title="Likely failure scenarios" icon="trending-down-outline" items={w.failureScenarios} tone="danger" />
      </Card>
      <BehaviorCard risks={a.behavioralRisks} />
    </>
  );
}

// ───────────────────────────── Improved strategy: comparison view ─────────────────────────────

/** YOUR STRATEGY vs PROP GUARD OPTIMIZED — your original wording always on the left. */
export function ComparisonView({ original, optimized }: { original: ChecklistSection[]; optimized: ChecklistSection[] }) {
  return (
    <Card>
      <SectionTitle icon="swap-horizontal-outline">Your strategy vs Prop Guard optimized</SectionTitle>
      <View style={[styles.cmpHead, { marginTop: spacing.md }]}>
        <AppText variant="label" style={styles.flex}>
          YOUR STRATEGY
        </AppText>
        <AppText variant="label" tone="accent" style={styles.flex}>
          PROP GUARD OPTIMIZED
        </AppText>
      </View>
      {optimized.map((sec) => {
        const left = original.find((o) => o.key === sec.key);
        const changed = sec.lines.some((l) => l.provenance !== 'trader' && l.status !== 'rejected');
        return (
          <View key={sec.key} style={[styles.block, styles.border]}>
            <View style={styles.row}>
              <AppText variant="label" style={styles.flex}>
                {sec.title.toUpperCase()}
              </AppText>
              {changed ? <StatusBadge label="improved" tone="accent" size="sm" /> : null}
            </View>
            <View style={styles.cmpRow}>
              <View style={styles.flex}>
                {left && !left.missing ? (
                  left.lines.map((l) => (
                    <AppText key={l.text} variant="body" style={{ fontStyle: 'italic' }}>
                      “{l.text}”
                    </AppText>
                  ))
                ) : (
                  <AppText variant="body" tone="tertiary">
                    —
                  </AppText>
                )}
              </View>
              <View style={styles.flex}>
                {sec.missing ? (
                  <AppText variant="body" tone="tertiary">
                    Not defined
                  </AppText>
                ) : (
                  sec.lines
                    .filter((l) => l.status !== 'rejected')
                    .map((l) => (
                      <View key={l.text} style={{ marginBottom: 4 }}>
                        <AppText variant="body" style={l.provenance === 'suggested' && l.status === 'pending' ? { color: colors.textSecondary } : undefined}>
                          {l.text}
                        </AppText>
                        <StatusBadge label={provenanceLabel(l.provenance, l.status)} tone={PROV_TONE[l.provenance]} size="sm" />
                      </View>
                    ))
                )}
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

// ───────────────────────────── Testable rules ─────────────────────────────

const BLOCK_TITLE: Record<string, string> = { setup: 'SETUP', entry: 'ENTRY', invalidation: 'INVALIDATION', exit: 'EXIT', noTrade: 'DO NOT TRADE' };

export function TestableRulesTab({ rules }: { rules: TestableRuleSet }) {
  return (
    <Card>
      <SectionTitle icon="code-slash-outline">Testable rules</SectionTitle>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Your plan as objective IF / THEN logic for Practice and future backtests. Built from your rules and the suggestions you accepted — pending suggestions are not included.
      </AppText>
      <View style={[styles.wrap, { marginTop: spacing.sm }]}>
        <StatusBadge label={`${rules.coverage.evaluable}/${rules.coverage.total} rules auto-checked`} tone={rules.coverage.testable ? 'positive' : 'warning'} icon="hardware-chip-outline" size="sm" />
        {!rules.coverage.testable ? <StatusBadge label="Entry not yet machine-checkable" tone="warning" size="sm" /> : null}
      </View>
      {rules.definitions.length ? (
        <View style={styles.block}>
          <AppText variant="label">DEFINITIONS</AppText>
          {rules.definitions.map((d) => (
            <AppText key={d} variant="caption" style={{ marginTop: 2 }}>
              • {d}
            </AppText>
          ))}
        </View>
      ) : null}
      {rules.blocks.map((b, i) => (
        <View key={`${b.kind}${i}`} style={[styles.block, styles.border]}>
          <AppText variant="label" tone="accent">
            {BLOCK_TITLE[b.kind]}
          </AppText>
          {b.if.map((l, k) => (
            <View key={l.text} style={styles.ifLine}>
              <AppText variant="label" style={styles.kw}>
                {b.kind === 'exit' ? '' : k === 0 ? 'IF' : 'AND'}
              </AppText>
              <AppText variant="body" style={styles.flex}>
                {l.text}
              </AppText>
              <Ionicons name={l.evaluable ? 'hardware-chip-outline' : 'eye-outline'} size={15} color={l.evaluable ? colors.positive : colors.warning} accessibilityLabel={l.evaluable ? 'Checked automatically' : 'Confirm visually'} />
            </View>
          ))}
          <View style={styles.ifLine}>
            <AppText variant="label" style={[styles.kw, { color: colors.accentBright }]}>
              THEN
            </AppText>
            <AppText variant="bodyStrong" style={styles.flex}>
              {b.then}
            </AppText>
          </View>
        </View>
      ))}
      <View style={[styles.row, { marginTop: spacing.sm }]}>
        <Ionicons name="hardware-chip-outline" size={14} color={colors.positive} />
        <AppText variant="caption">checked on candles automatically</AppText>
        <Ionicons name="eye-outline" size={14} color={colors.warning} style={{ marginLeft: spacing.sm }} />
        <AppText variant="caption">confirm visually</AppText>
      </View>
    </Card>
  );
}

// ───────────────────────────── Market conditions ─────────────────────────────

function RegimeCard({ r }: { r: RegimeAssessment }) {
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {r.label}
        </AppText>
        <ConfidenceBadge label={r.confidence} />
      </View>
      {r.reasons.map((x) => (
        <AppText key={x} variant="caption" style={{ marginTop: 2 }}>
          • {x}
        </AppText>
      ))}
    </View>
  );
}

export function BestConditionsTab({ a }: { a: StructuredStrategy }) {
  const good = a.regimes.filter((r) => r.fit === 'designed_for');
  return (
    <Card tone="positive">
      <SectionTitle icon="sunny-outline" tone="positive">
        Best market conditions
      </SectionTitle>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Environments the strategy is designed for, from your rules and the concepts you use. Not a performance claim.
      </AppText>
      {good.length ? good.map((r) => <RegimeCard key={r.regime} r={r} />) : <AppText variant="body" style={{ marginTop: spacing.sm }}>Not enough in the plan to tell which conditions it is built for — Practice will show where it behaves best.</AppText>}
    </Card>
  );
}

export function AvoidWhenTab({ a }: { a: StructuredStrategy }) {
  const avoid = a.regimes.filter((r) => r.fit === 'avoid');
  const own = a.noTradeRules.filter((r) => r.provenance === 'trader');
  return (
    <Card tone="warning">
      <SectionTitle icon="hand-left-outline" tone="warning">
        Avoid when
      </SectionTitle>
      {own.length ? (
        <View style={styles.block}>
          <AppText variant="bodyStrong">Your own do-not-trade rules</AppText>
          {own.map((r) => (
            <AppText key={r.id} variant="body" style={{ marginTop: 2, fontStyle: 'italic' }}>
              “{r.text}”
            </AppText>
          ))}
        </View>
      ) : null}
      {avoid.length ? avoid.map((r) => <RegimeCard key={r.regime} r={r} />) : <AppText variant="body" style={{ marginTop: spacing.sm }}>No specific conditions to avoid could be derived from the plan yet.</AppText>}
    </Card>
  );
}

// ───────────────────────────── Practice ─────────────────────────────

export function PracticeTab({ rules, onPractice, busy }: { rules: TestableRuleSet; onPractice: () => void; busy: boolean }) {
  const auto = rules.conditions.filter((c) => c.evaluable && c.role !== 'noTrade');
  const visual = rules.conditions.filter((c) => !c.evaluable && c.role !== 'noTrade');
  return (
    <Card>
      <SectionTitle icon="school-outline">Practice this strategy</SectionTitle>
      <AppText variant="body" tone="secondary" style={{ marginTop: 2 }}>
        Prop Guard runs YOUR rules candle by candle (never looking ahead), stops at each signal and asks you to decide. Until verified market data is connected, the candles are SIMULATED.
      </AppText>
      <View style={styles.block}>
        <AppText variant="label" tone="positive">
          CHECKED AUTOMATICALLY ({auto.length})
        </AppText>
        {auto.length ? auto.map((c) => <AppText key={c.id} variant="body" style={{ marginTop: 2 }}>✓ {c.text}</AppText>) : <AppText variant="caption">None yet — accept measurable definitions in “Why These Changes”.</AppText>}
      </View>
      {visual.length ? (
        <View style={styles.block}>
          <AppText variant="label" tone="warning">
            YOU CONFIRM VISUALLY ({visual.length})
          </AppText>
          {visual.map((c) => (
            <AppText key={c.id} variant="body" style={{ marginTop: 2 }}>
              ◦ {c.text}
            </AppText>
          ))}
        </View>
      ) : null}
      <View style={styles.block}>
        <AppText variant="label">STOP · TARGET</AppText>
        <AppText variant="body" style={{ marginTop: 2 }}>
          {rules.stop.text}
        </AppText>
        <AppText variant="body">{rules.target.text}</AppText>
      </View>
      {rules.practiceDefaults.length ? (
        <View style={[styles.block, styles.note]}>
          <AppText variant="label" tone="warning">
            PRACTICE DEFAULTS (not part of your plan)
          </AppText>
          {rules.practiceDefaults.map((d) => (
            <AppText key={d} variant="caption" style={{ marginTop: 2 }}>
              • {d}
            </AppText>
          ))}
        </View>
      ) : null}
      <Button
        label={rules.coverage.testable ? 'Practice my rules (simulated data)' : 'Entry is not machine-checkable yet'}
        icon="play"
        style={{ marginTop: spacing.md }}
        disabled={!rules.coverage.testable}
        loading={busy}
        onPress={onPractice}
      />
      <AppText variant="caption" style={{ marginTop: spacing.sm }}>
        Results from simulated data are practice only. Real performance statistics appear only after verified historical data is connected — Prop Guard never labels a rule “historically validated” without it.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: spacing.sm, paddingVertical: spacing.xs },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
  block: { paddingVertical: spacing.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  insight: { marginTop: spacing.sm },
  dnaRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  dnaLabel: { width: 96, fontSize: 10 },
  dnaValue: { gap: 2, alignItems: 'flex-start', marginBottom: spacing.sm },
  cmpHead: { flexDirection: 'row', gap: spacing.md },
  cmpRow: { flexDirection: 'row', gap: spacing.md, marginTop: 4 },
  ifLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: 4 },
  kw: { width: 38, fontSize: 11 },
  note: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.sm },
});
