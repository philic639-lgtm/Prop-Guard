import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Card, EmptyState, MetricTile, Screen, SectionHeader, TileGrid } from '@/components/ui';
import { PRACTICE_DISCLAIMER } from '@/constants/legal';
import { spacing } from '@/constants/theme';
import { AccuracyList, SetupProfileCard } from '@/features/practice/components/PracticeAnalytics';
import { PersonalEdgeInsights } from '@/features/practice/components/PersonalEdgeInsights';
import {
  accuracyOf,
  calculateAverageScore,
  calculateIdealDecisionAccuracy,
  calculateInstrumentAccuracy,
  calculateRetestAccuracy,
  calculateSessionAccuracy,
  calculateStrategyAccuracy,
  calculateStreak,
  calculateStrongestSetup,
  calculateWeakestSetup,
  generatePracticeInsights,
} from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** Practice performance dashboard — computed only from the trader's own practice attempts. */
export default function PracticeAnalyticsScreen() {
  const attempts = useAppStore((s) => s.practiceAttempts);
  const d = useMemo(() => {
    const ideal = calculateIdealDecisionAccuracy(attempts);
    const byIdeal = (k: string) => ideal.find((g) => g.key === k) ?? null;
    return {
      accuracy: accuracyOf(attempts),
      avg: calculateAverageScore(attempts),
      streak: calculateStreak(attempts),
      long: byIdeal('long'),
      short: byIdeal('short'),
      wait: byIdeal('wait'),
      strategies: calculateStrategyAccuracy(attempts),
      instruments: calculateInstrumentAccuracy(attempts),
      sessions: calculateSessionAccuracy(attempts),
      retests: calculateRetestAccuracy(attempts),
      directions: ideal,
      strongest: calculateStrongestSetup(attempts),
      weakest: calculateWeakestSetup(attempts),
      insights: generatePracticeInsights(attempts),
    };
  }, [attempts]);

  if (attempts.length === 0) {
    return (
      <Screen header={<AppHeader title="Practice analytics" back />}>
        <Card>
          <EmptyState icon="stats-chart-outline" title="No practice yet" message="Complete a few practice scenarios and your accuracy, scores and personal edge insights will appear here." actionLabel="Start practising" onAction={() => router.replace('/practice')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader title="Practice analytics" subtitle={`${attempts.length} scenarios`} back />}>
      <TileGrid>
        <MetricTile label="Overall accuracy" value={pct(d.accuracy)} tone={(d.accuracy ?? 0) >= 0.6 ? 'positive' : 'warning'} align="center" />
        <MetricTile label="Avg Prop Guard score" value={d.avg != null ? String(d.avg) : '—'} align="center" />
        <MetricTile label="Scenarios completed" value={String(attempts.length)} align="center" />
        <MetricTile label="Current streak" value={String(d.streak)} sub="correct in a row" align="center" />
      </TileGrid>

      <TileGrid>
        <MetricTile label="Long accuracy" value={pct(d.long?.accuracy ?? null)} sub={d.long ? `${d.long.attempts} valid longs` : 'No attempts'} tone={d.long ? 'positive' : 'primary'} align="center" />
        <MetricTile label="Short accuracy" value={pct(d.short?.accuracy ?? null)} sub={d.short ? `${d.short.attempts} valid shorts` : 'No attempts'} tone={d.short ? 'danger' : 'primary'} align="center" />
        <MetricTile label="Wait accuracy" value={pct(d.wait?.accuracy ?? null)} sub={d.wait ? `${d.wait.attempts} no-trade setups` : 'No attempts'} align="center" />
      </TileGrid>
      <AppText variant="caption">
        Accuracy = your decision matched the strategy rules (LONG, SHORT or WAIT) — not whether the trade made money.
      </AppText>

      <SectionHeader title="Personal edge" />
      <PersonalEdgeInsights insights={d.insights} attempts={attempts.length} />

      <View style={styles.pair}>
        <SetupProfileCard title="Your strongest setup" profile={d.strongest} tone="positive" />
        <SetupProfileCard title="Your weakest setup" profile={d.weakest} tone="warning" />
      </View>

      <SectionHeader title="Performance by strategy" />
      <AccuracyList groups={d.strategies} />
      <SectionHeader title="By setup direction" />
      <AccuracyList groups={d.directions} />
      <SectionHeader title="By instrument" />
      <AccuracyList groups={d.instruments} />
      <SectionHeader title="By session" />
      <AccuracyList groups={d.sessions} />
      <SectionHeader title="By retest number" />
      <AccuracyList groups={d.retests} empty="No retest-based scenarios practised yet." />

      <AppText variant="caption" tone="tertiary" style={{ marginTop: spacing.md }}>
        Calculated only from your own practice attempts on educational sample scenarios. {PRACTICE_DISCLAIMER}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});
