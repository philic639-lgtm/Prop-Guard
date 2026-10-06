import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, CircularScore, StatusBadge, VerdictBanner } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import type { CriterionResult, CriterionStatus, SetupDecision } from '@/lib/engines/setupValidation';
import type { SetupCheck } from '@/types/domain';
import { money } from '@/utils/format';

export const DECISION_UI: Record<SetupDecision, { title: string; emoji: string; tone: 'positive' | 'warning' | 'danger'; icon: keyof typeof Ionicons.glyphMap }> = {
  QUALIFIED: { title: 'QUALIFIED', emoji: '🟢', tone: 'positive', icon: 'shield-checkmark' },
  WAIT: { title: 'WAIT', emoji: '🟡', tone: 'warning', icon: 'hourglass-outline' },
  STAND_DOWN: { title: 'STAND DOWN', emoji: '🔴', tone: 'danger', icon: 'hand-left-outline' },
};

const STATUS_UI: Record<CriterionStatus, { mark: string; label: string; tone: Tone; color: string }> = {
  PASS: { mark: '✓', label: 'PASS', tone: 'positive', color: colors.positive },
  FAIL: { mark: '✕', label: 'FAIL', tone: 'danger', color: colors.danger },
  UNVERIFIED: { mark: '?', label: 'UNVERIFIED', tone: 'warning', color: colors.warning },
  NOT_APPLICABLE: { mark: '—', label: 'N/A', tone: 'neutral', color: colors.textTertiary },
};

const scoreTone = (s: number | null): Tone => (s == null ? 'neutral' : s >= 80 ? 'positive' : s >= 70 ? 'accent' : 'warning');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label">{title}</AppText>
      {children}
    </View>
  );
}

function RuleRow({ r }: { r: CriterionResult }) {
  const ui = STATUS_UI[r.status];
  return (
    <View style={styles.rule} accessible accessibilityLabel={`${r.ruleName}: ${ui.label}. ${r.evidence}`}>
      <View style={[styles.mark, { borderColor: ui.color }]}>
        <AppText style={{ color: ui.color, fontWeight: '800', fontSize: 14 }}>{ui.mark}</AppText>
      </View>
      <View style={styles.flex}>
        <View style={styles.wrap}>
          <AppText variant="bodyStrong" style={styles.flexShrink}>
            {r.ruleName}
          </AppText>
          <StatusBadge label={ui.label} tone={ui.tone} size="sm" />
          {r.required ? <StatusBadge label="Required" tone="neutral" size="sm" /> : <StatusBadge label="Optional" tone="neutral" size="sm" />}
          {r.propVerification && r.propVerification !== 'verified' ? <StatusBadge label="PROP RULE UNVERIFIED" tone="warning" size="sm" /> : null}
          {r.propVerification === 'verified' ? <StatusBadge label="Verified firm rule" tone="positive" size="sm" /> : null}
        </View>
        <AppText variant="caption" style={{ marginTop: 2 }}>
          “{r.evidence}”
        </AppText>
        {r.kind === 'visual' && r.status !== 'NOT_APPLICABLE' ? (
          <AppText variant="caption" tone="tertiary">
            Evidence confidence {Math.round(r.confidence * 100)}%
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function RiskRow({ label, value, tone }: { label: string; value: string; tone?: React.ComponentProps<typeof AppText>['tone'] }) {
  return (
    <View style={styles.riskRow}>
      <AppText variant="body" tone="secondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong" tone={tone ?? 'primary'}>
        {value}
      </AppText>
    </View>
  );
}

/** SETUP CHECK result card — decision is the app's deterministic verdict on the trader's own rules. */
export function SetupCheckResult({ check }: { check: SetupCheck }) {
  const d = DECISION_UI[check.decision];
  const r = check.risk;
  const propConflicts = check.criteria.filter((c) => c.kind === 'prop' && c.status === 'FAIL');
  const order: Record<CriterionStatus, number> = { FAIL: 0, UNVERIFIED: 1, PASS: 2, NOT_APPLICABLE: 3 };
  const rules = [...check.criteria].sort((a, b) => Number(b.required) - Number(a.required) || order[a.status] - order[b.status]);
  const hasRisk = r && (r.entry != null || r.stop != null || r.target != null);

  return (
    <View style={{ gap: spacing.md }}>
      {check.provider === 'mock' ? (
        <Card tone="warning">
          <View style={styles.wrap}>
            <Ionicons name="flask-outline" size={18} color={colors.warning} />
            <AppText variant="bodyStrong" tone="warning">
              DEMO ANALYSIS — simulated
            </AppText>
          </View>
          <AppText variant="caption" style={{ marginTop: 4 }}>
            AI chart reading isn’t configured, so the chart rules below are simulated to show how Setup Check works. Your risk, prop and plan checks are real.
          </AppText>
        </Card>
      ) : null}

      <Card>
        <AppText variant="label" tone="accent">
          Setup check
        </AppText>
        <View style={[styles.wrap, { marginTop: spacing.sm, gap: spacing.lg }]}>
          <CircularScore value={check.score ?? 0} tone={scoreTone(check.score)} size={96} label="/ 100" />
          <View style={styles.flex}>
            <AppText variant="heading">{check.score == null ? 'Score —' : `Score: ${check.score}/100`}</AppText>
            <AppText variant="body" tone="secondary">
              Grade: {check.gradeLabel}
            </AppText>
            <AppText variant="caption" style={{ marginTop: 4 }}>
              {check.strategyName} · {check.instrument}
              {check.timeframe ? ` · ${check.timeframe}` : ''} · {check.direction === 'unsure' ? 'Direction unsure' : check.direction === 'long' ? 'Long' : 'Short'}
            </AppText>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <VerdictBanner tone={d.tone} title={d.title} subtitle={`${d.emoji} ${check.requiredPassed} of ${check.requiredTotal} required rules met · final status computed by Prop Guard from your saved rules`} icon={d.icon} />
        </View>
      </Card>

      <Card>
        <Section title="Why">
          <AppText variant="body">{check.why}</AppText>
          {check.summary ? (
            <AppText variant="caption" style={{ marginTop: 4 }}>
              Chart reading: {check.summary}
            </AppText>
          ) : null}
        </Section>
      </Card>

      <Card>
        <Section title="Rule check">
          <AppText variant="caption">✓ PASS · ✕ FAIL · ? UNVERIFIED · — N/A — missing evidence never counts as a pass.</AppText>
          {rules.map((x) => (
            <RuleRow key={x.ruleId} r={x} />
          ))}
        </Section>
      </Card>

      <Card>
        <Section title="Risk check">
          {hasRisk ? (
            <>
              <RiskRow label="Entry" value={r.entry != null ? String(r.entry) : '—'} />
              <RiskRow label="Stop" value={r.stop != null ? String(r.stop) : '—'} />
              <RiskRow label="Target" value={r.target != null ? String(r.target) : '—'} />
              <RiskRow label={`Risk${r.contracts ? ` (${r.contracts} ct)` : ' (1 ct)'}`} value={r.riskDollars != null ? `${money(r.riskDollars)}${r.pointsRisk != null ? ` · ${r.pointsRisk} pts` : ''}` : '—'} />
              <RiskRow label="Reward" value={r.rewardDollars != null ? `${money(r.rewardDollars)}${r.pointsReward != null ? ` · ${r.pointsReward} pts` : ''}` : '—'} />
              <RiskRow label="R:R" value={r.rr != null ? `1:${r.rr}` : '—'} />
              {r.maxContractsForBudget != null ? <RiskRow label="Max size within your risk budget" value={`${r.maxContractsForBudget} contract${r.maxContractsForBudget === 1 ? '' : 's'}`} /> : null}
              {r.pricesFrom === 'chart' || r.pricesFrom === 'mixed' ? (
                <AppText variant="caption" tone="warning">
                  Some prices were read from the chart — confirm them before relying on this.
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText variant="caption">Entry / stop / target prices are required to verify R:R and size the risk.</AppText>
          )}
          {propConflicts.map((c) => (
            <AppText key={c.ruleId} variant="caption" tone={c.required ? 'danger' : 'warning'}>
              Prop-firm risk conflict: {c.ruleName} — {c.evidence}
            </AppText>
          ))}
        </Section>
      </Card>

      <Card>
        <Section title="Evidence quality">
          <RiskRow label="Evidence confidence" value={`${check.evidenceConfidence}/100`} tone={check.evidenceConfidence >= 60 ? 'positive' : 'warning'} />
          <RiskRow label="Screenshot quality" value={`${Math.round(check.imageQuality.score)}/100`} tone={check.imageQuality.score >= 40 ? 'primary' : 'warning'} />
          {check.chart.timeframe ? <RiskRow label="Timeframe seen" value={check.chart.timeframe} /> : <AppText variant="caption">Timeframe cannot be verified from the screenshot.</AppText>}
          {check.imageQuality.issues.map((i) => (
            <AppText key={i} variant="caption" tone="warning">
              • {i}
            </AppText>
          ))}
        </Section>
      </Card>

      <Card tone={d.tone}>
        <Section title="What needs to happen next">
          {check.next.map((n) => (
            <AppText key={n} variant="body">
              • {n}
            </AppText>
          ))}
        </Section>
      </Card>

      {check.screenshotUri ? <Image source={{ uri: check.screenshotUri }} style={styles.shot} contentFit="contain" accessibilityLabel="Analyzed chart screenshot" /> : null}

      <AppText variant="caption" tone="tertiary" align="center">
        Prop Guard checks whether this setup satisfies YOUR saved rules and risk limits. It does not predict price or results.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flexShrink: { flexShrink: 1 },
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  section: { gap: spacing.sm },
  rule: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  riskRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  shot: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
});
