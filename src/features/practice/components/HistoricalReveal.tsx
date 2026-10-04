import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, DetailTable, StatusBadge } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import type { HistoricalSimilarityStats } from '@/lib/engines/historicalSimilarityEngine';
import type { PracticeScenario, PracticeScore, PracticeTradeInput, ReplayOutcome } from '@/types/practice';

import { GRADE_TONE } from './PracticeScoreCard';

type Historical = NonNullable<PracticeScenario['historical']>;

/** "REAL HISTORICAL SCENARIO" only for verified provider data — everything else says SIMULATED. */
export function HistoricalSourceBadge({ scenario: s }: { scenario: PracticeScenario }) {
  return s.source.verified ? (
    <StatusBadge label="REAL HISTORICAL SCENARIO" tone="positive" icon="shield-checkmark" size="sm" />
  ) : (
    <StatusBadge label="SIMULATED SCENARIO" tone="warning" icon="flask-outline" size="sm" />
  );
}

const signedR = (r: number) => `${r > 0 ? '+' : ''}${r}R`;
const DECISION = { long: 'LONG', short: 'SHORT', wait: 'SKIP' } as const;

function plannedOutcome(o: Historical['outcome']) {
  if (o.status === 'target') return { text: 'Target first', tone: colors.positive };
  if (o.status === 'stop') return { text: o.ambiguous ? 'Stop first*' : 'Stop first', tone: colors.danger };
  return { text: 'Neither hit', tone: colors.warning };
}

const USER_RESULT: Record<ReplayOutcome['status'], string> = {
  target: 'Your target hit',
  stop: 'Your stop hit',
  expired: 'Still open at end',
  not_filled: 'Entry not filled',
  no_trade: 'You stood aside',
};

/** YOUR DECISION · ACTUAL OUTCOME · SCORE — shown once the future has been revealed. */
export function HistoricalResultCard({ scenario: s, input, score, replay }: { scenario: PracticeScenario; input: PracticeTradeInput; score: PracticeScore; replay: ReplayOutcome }) {
  const h = s.historical!;
  const po = plannedOutcome(h.outcome);
  const decisionColor = input.decision === 'long' ? colors.positive : input.decision === 'short' ? colors.danger : colors.text;
  return (
    <Card>
      <View style={styles.cols}>
        <Col label="Your decision" value={DECISION[input.decision]} color={decisionColor} sub={USER_RESULT[replay.status]} />
        <Col label="Actual outcome" value={po.text} color={po.tone} sub={`Planned ${s.direction.toUpperCase()} · ${signedR(h.outcome.rrAchieved)}`} />
        <Col label="Score" value={`${score.total}`} color={colors.text} sub={`/ 100 · ${score.grade}`} badgeTone={GRADE_TONE[score.grade]} />
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.md }}>
        {s.idealDecision === 'wait' ? 'The strategy rules were not all met at the decision candle — the plan was to SKIP. ' : `Every rule was met — the plan was ${DECISION[s.idealDecision]}. `}
        Your score grades the decision, not the result: a well-planned trade that loses can still score highly.
      </AppText>
      {h.outcome.ambiguous ? (
        <AppText variant="caption" tone="warning" style={{ marginTop: spacing.xs }}>
          * Stop and target were both inside one candle. The order is unknown, so it is counted conservatively as a stop.
        </AppText>
      ) : null}
    </Card>
  );
}

function Col({ label, value, sub, color, badgeTone }: { label: string; value: string; sub: string; color: string; badgeTone?: Tone }) {
  return (
    <View style={styles.col}>
      <AppText variant="label" style={{ fontSize: 10 }} align="center">
        {label}
      </AppText>
      <AppText variant="heading" style={{ color, marginTop: 4 }} align="center">
        {value}
      </AppText>
      {badgeTone ? (
        <View style={{ marginTop: 4, alignItems: 'center' }}>
          <StatusBadge label={sub} tone={badgeTone} size="sm" />
        </View>
      ) : (
        <AppText variant="caption" align="center" style={{ marginTop: 2 }}>
          {sub}
        </AppText>
      )}
    </View>
  );
}

const minutes = (m: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

/**
 * Historical analysis: similarity statistics from VERIFIED stored scenarios only.
 * With too few verified samples (or simulated data) no statistics are shown.
 */
export function HistoricalAnalysisCard({ scenario: s, stats, lines }: { scenario: PracticeScenario; stats: HistoricalSimilarityStats | null; lines: string[] }) {
  const o = s.historical!.outcome;
  const hasStats = !!stats && !stats.limited;
  return (
    <Card>
      <View style={styles.row}>
        <Ionicons name="analytics-outline" size={16} color={colors.accentBright} />
        <AppText variant="label" tone="accent">
          Historical analysis
        </AppText>
      </View>
      {!s.source.verified ? (
        <View style={styles.note}>
          <AppText variant="body" tone="warning">
            SIMULATED scenario — similar-setup statistics are only calculated from verified historical data.
          </AppText>
        </View>
      ) : null}
      {lines.map((l) => (
        <View key={l} style={styles.line}>
          <Ionicons name={hasStats ? 'stats-chart-outline' : 'information-circle-outline'} size={15} color={hasStats ? colors.accentBright : colors.warning} />
          <AppText variant="body" style={styles.flex}>
            {l}
          </AppText>
        </View>
      ))}
      {stats && stats.limited && stats.sampleSize > 0 ? (
        <AppText variant="caption" style={{ marginTop: spacing.xs }}>
          Limited historical sample — statistics are withheld until enough verified setups exist.
        </AppText>
      ) : null}

      <AppText variant="label" style={{ marginTop: spacing.lg }}>
        What the planned trade did
      </AppText>
      <DetailTable
        rows={[
          { label: 'Result', value: o.status === 'target' ? 'Target before stop' : o.status === 'stop' ? 'Stop before target' : 'Neither reached', bold: true, tone: o.status === 'target' ? 'positive' : o.status === 'stop' ? 'danger' : 'warning' },
          { label: 'R achieved', value: signedR(o.rrAchieved) },
          { label: 'Max favorable (MFE)', value: `${o.mfeR}R` },
          { label: 'Max adverse (MAE)', value: `${o.maeR}R` },
          { label: 'Best R after entry', value: `${o.bestRAfterEntry}R` },
          { label: o.status === 'target' ? 'Time to target' : o.status === 'stop' ? 'Time to stop' : 'Duration', value: minutes(o.status === 'target' ? o.timeToTargetMinutes : o.status === 'stop' ? o.timeToStopMinutes : o.durationMinutes) },
          ...(o.ambiguous ? [{ label: 'Same-candle conflict', value: 'Yes — counted as stop', tone: 'warning' as const }] : []),
        ]}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  note: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
});
