import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, CircularScore, StatusBadge, VerdictBanner } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import type { AnalysisMode, Check, Decision, SetupEvaluation, Status } from '@/lib/engines/setupCheck';
import { money } from '@/utils/format';

/**
 * Decision display. The engine's 'TAKE TRADE' is shown with Prop Guard's
 * established wording "QUALIFIED" — rule compliance, never an instruction to trade.
 */
export const DECISION_UI: Record<Decision, { title: string; emoji: string; tone: 'positive' | 'warning' | 'danger'; icon: keyof typeof Ionicons.glyphMap }> = {
  'TAKE TRADE': { title: 'QUALIFIED', emoji: '🟢', tone: 'positive', icon: 'shield-checkmark' },
  WAIT: { title: 'WAIT', emoji: '🟡', tone: 'warning', icon: 'hourglass-outline' },
  'STAND DOWN': { title: 'STAND DOWN', emoji: '🔴', tone: 'danger', icon: 'hand-left-outline' },
};

const STATUS_UI: Record<Status | 'NOT_APPLICABLE', { mark: string; label: string; tone: Tone; color: string }> = {
  PASS: { mark: '✓', label: 'PASS', tone: 'positive', color: colors.positive },
  FAIL: { mark: '✕', label: 'FAIL', tone: 'danger', color: colors.danger },
  UNVERIFIED: { mark: '?', label: 'UNVERIFIED', tone: 'warning', color: colors.warning },
  NOT_APPLICABLE: { mark: '—', label: 'N/A', tone: 'neutral', color: colors.textTertiary },
};

const SOURCE_LABEL: Record<string, string> = { manual: 'You confirmed', vision: 'Chart analysis', broker: 'Broker', demo: 'DEMO (ignored)', system: 'Prop Guard' };

export type ResultData = Pick<
  SetupEvaluation,
  'decision' | 'ruleAlignmentScore' | 'evidenceConfidence' | 'riskCheck' | 'propFirmCompliance' | 'passedRequired' | 'totalRequired' | 'evaluatedRules' | 'riskChecks' | 'propChecks' | 'blockers' | 'dollarRisk' | 'reward' | 'rr' | 'analysisMode'
>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label">{title}</AppText>
      {children}
    </View>
  );
}

function StatusMark({ status }: { status: Status | 'NOT_APPLICABLE' }) {
  const ui = STATUS_UI[status];
  return (
    <View style={[styles.mark, { borderColor: ui.color }]}>
      <AppText style={{ color: ui.color, fontWeight: '800', fontSize: 14 }}>{ui.mark}</AppText>
    </View>
  );
}

function CheckRow({ c }: { c: Check }) {
  const ui = STATUS_UI[c.status];
  return (
    <View style={styles.rule} accessible accessibilityLabel={`${c.label}: ${ui.label}. ${c.reason}`}>
      <StatusMark status={c.status} />
      <View style={styles.flex}>
        <View style={styles.wrap}>
          <AppText variant="bodyStrong" style={styles.flexShrink}>
            {c.label}
          </AppText>
          <StatusBadge label={ui.label} tone={ui.tone} size="sm" />
        </View>
        <AppText variant="caption" style={{ marginTop: 2 }}>
          {c.reason}
        </AppText>
      </View>
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: React.ComponentProps<typeof AppText>['tone'] }) {
  return (
    <View style={styles.riskRow}>
      <AppText variant="body" tone="secondary" style={styles.flexShrink}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" tone={tone ?? 'primary'}>
        {value}
      </AppText>
    </View>
  );
}

const statusTone = (s: string): React.ComponentProps<typeof AppText>['tone'] => (s === 'PASS' ? 'positive' : s === 'FAIL' ? 'danger' : s === 'NOT_APPLICABLE' ? 'secondary' : 'warning');

export function AnalysisModeBanner({ mode }: { mode: AnalysisMode }) {
  if (mode === 'REAL') return null;
  return (
    <Card tone="warning">
      <View style={styles.wrap}>
        <Ionicons name={mode === 'DEMO' ? 'flask-outline' : 'eye-off-outline'} size={18} color={colors.warning} />
        <AppText variant="bodyStrong" tone="warning">
          {mode === 'DEMO' ? 'DEMO ANALYSIS — simulated' : 'Chart analysis unavailable'}
        </AppText>
      </View>
      <AppText variant="caption" style={{ marginTop: 4 }}>
        {mode === 'DEMO'
          ? 'DEMO ANALYSIS — simulated observations do not count as evidence, and a demo check can never clear a setup.'
          : 'Chart analysis unavailable — only confirmed manual or broker evidence counts.'}
      </AppText>
    </Card>
  );
}

/**
 * SETUP CHECK result — every value comes from the deterministic engine
 * (`evaluateSetup`). The score measures confirmed rule completion, not the
 * probability of winning; no grade is shown.
 */
export function SetupCheckResult({ result, meta, screenshotUri, pending }: { result: ResultData; meta: { strategyName: string; instrument: string; timeframe: string | null; direction: string; evaluatedBy: 'server' | 'device' | null }; screenshotUri?: string | null; pending?: boolean }) {
  const d = DECISION_UI[result.decision];
  const blocked = result.decision !== 'TAKE TRADE';
  const order: Record<string, number> = { FAIL: 0, UNVERIFIED: 1, PASS: 2 };
  const rules = [...result.evaluatedRules].sort((a, b) => Number(b.required || b.critical) - Number(a.required || a.critical) || order[a.status] - order[b.status]);

  return (
    <View style={{ gap: spacing.md }}>
      <AnalysisModeBanner mode={result.analysisMode} />

      <Card>
        <View style={styles.wrap}>
          <AppText variant="label" tone="accent" style={styles.flex}>
            Setup check
          </AppText>
          {pending ? <StatusBadge label="Updating…" tone="neutral" size="sm" /> : null}
          {meta.evaluatedBy ? <StatusBadge label={meta.evaluatedBy === 'server' ? 'Checked by Prop Guard server' : 'Checked on this device'} tone="neutral" size="sm" /> : null}
        </View>
        <View style={[styles.wrap, { marginTop: spacing.sm, gap: spacing.lg }]}>
          <CircularScore value={result.ruleAlignmentScore} tone={blocked ? 'warning' : 'positive'} size={96} label="/ 100" />
          <View style={styles.flex}>
            <AppText variant="heading">Rule alignment {result.ruleAlignmentScore}/100</AppText>
            <AppText variant="body" tone="secondary">
              {result.passedRequired}/{result.totalRequired} required rules confirmed
            </AppText>
            <AppText variant="caption" style={{ marginTop: 4 }}>
              {blocked ? 'Setup incomplete or blocked' : 'Required rules confirmed'} · measures confirmed rule completion, not the chance of winning.
            </AppText>
            <AppText variant="caption" tone="tertiary" style={{ marginTop: 2 }}>
              {meta.strategyName} · {meta.instrument}
              {meta.timeframe ? ` · ${meta.timeframe}` : ''} · {meta.direction}
            </AppText>
          </View>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <VerdictBanner tone={d.tone} title={d.title} subtitle={`${d.emoji} ${blocked ? `${result.blockers.length} item${result.blockers.length === 1 ? '' : 's'} still blocking` : 'Required rules confirmed — rule compliance, not a prediction'}`} icon={d.icon} />
        </View>
      </Card>

      <Card>
        <Section title="Checks">
          <Metric label="Rule alignment" value={`${result.ruleAlignmentScore}/100 — ${result.passedRequired}/${result.totalRequired} required`} />
          <Metric label="Evidence confidence" value={`${result.evidenceConfidence}/100`} tone={result.evidenceConfidence >= 80 ? 'positive' : 'warning'} />
          <AppText variant="caption" tone="tertiary">
            Evidence quality, not likelihood of winning.
          </AppText>
          <Metric label="Risk check" value={result.riskCheck} tone={statusTone(result.riskCheck)} />
          <Metric label="Prop firm compliance" value={result.propFirmCompliance === 'NOT_APPLICABLE' ? 'N/A' : result.propFirmCompliance} tone={statusTone(result.propFirmCompliance)} />
          <Metric label="Estimated dollar risk" value={result.dollarRisk === null ? 'UNVERIFIED' : money(result.dollarRisk, { cents: true })} tone={result.dollarRisk === null ? 'warning' : 'primary'} />
          <Metric label="Net reward / risk" value={result.rr === null ? 'UNVERIFIED' : `1:${result.rr.toFixed(2)}`} tone={result.rr === null ? 'warning' : 'primary'} />
        </Section>
      </Card>

      <Card>
        <Section title="Rule evidence">
          <AppText variant="caption">Missing, ambiguous, low-confidence or demo evidence never counts as a pass.</AppText>
          {rules.map((r, i) => {
            const ui = STATUS_UI[r.status];
            return (
              <View key={`${r.id}:${i}`} style={styles.rule} accessible accessibilityLabel={`${r.label}: ${ui.label}. ${r.reason}`}>
                <StatusMark status={r.status} />
                <View style={styles.flex}>
                  <View style={styles.wrap}>
                    <AppText variant="bodyStrong" style={styles.flexShrink}>
                      {r.label}
                    </AppText>
                    <StatusBadge label={ui.label} tone={ui.tone} size="sm" />
                    <StatusBadge label={r.critical ? 'Critical' : r.required ? 'Required' : 'Optional'} tone={r.critical ? 'danger' : 'neutral'} size="sm" />
                    {r.source ? <StatusBadge label={SOURCE_LABEL[r.source] ?? r.source} tone={r.source === 'demo' ? 'warning' : 'neutral'} size="sm" /> : null}
                  </View>
                  <AppText variant="caption" style={{ marginTop: 2 }}>
                    {r.reason}
                  </AppText>
                </View>
              </View>
            );
          })}
        </Section>
      </Card>

      <Card>
        <Section title="Risk check">
          {result.riskChecks.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </Section>
      </Card>

      {result.propChecks.length ? (
        <Card>
          <Section title="Prop firm compliance">
            {result.propChecks.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </Section>
        </Card>
      ) : null}

      <Card tone={d.tone}>
        <Section title="What needs to happen next">
          {result.blockers.length ? (
            result.blockers.map((b, i) => (
              <AppText key={`${b.id}:${i}`} variant="body">
                • {b.label}: {b.reason}
              </AppText>
            ))
          ) : (
            <AppText variant="body">No remaining blockers in the supplied checks.</AppText>
          )}
        </Section>
      </Card>

      {screenshotUri ? <Image source={{ uri: screenshotUri }} style={styles.shot} contentFit="contain" accessibilityLabel="Checked chart screenshot" /> : null}

      <AppText variant="caption" tone="tertiary" align="center">
        Rules confirmed does not guarantee profit. This checks the supplied setup; it does not place an order. A stop does not guarantee a capped loss.
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
