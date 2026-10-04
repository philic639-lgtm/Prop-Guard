import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ProGate } from '@/components/domain/ProGate';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  Chip,
  HeaderIconButton,
  MetricTile,
  OptionCard,
  Screen,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusBadge,
  TileGrid,
} from '@/components/ui';
import { PRACTICE_DISCLAIMER, SAMPLE_DATA_NOTE } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { PRACTICE_INSTRUMENTS } from '@/data/practice/scenarioFactory';
import { GRADE_TONE } from '@/features/practice/components/PracticeScoreCard';
import { filtersFor, pickScenario, usePracticeSetup, type PracticeMode } from '@/features/practice/selection';
import { summarizePractice } from '@/lib/engines';
import { scenarioProvider } from '@/services/marketHistory';
import { useAppStore } from '@/store/useAppStore';
import type { PracticeAttempt } from '@/types/practice';
import { shortDate } from '@/utils/format';

const ANY = '__any__';
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const RESULT: Record<PracticeAttempt['result'], string> = {
  win: 'Win',
  loss: 'Loss',
  expired: 'Expired',
  'not-filled': 'Not filled',
  'correct-wait': 'Correct wait',
  'incorrect-wait': 'Missed setup',
};

/** Historical Trading Trainer home: pick instrument / strategy / difficulty and practice. */
export default function PracticeHome() {
  const params = useLocalSearchParams<{ strategyId?: string }>();
  const attempts = useAppStore((s) => s.practiceAttempts);
  const strategies = useAppStore((s) => s.strategies);
  const setup = usePracticeSetup((s) => s.setup);
  const setSetup = usePracticeSetup((s) => s.setSetup);

  // Strategies come from the Strategy Library; only those with practice scenarios are offered.
  const strategyOptions = useMemo(() => {
    const ids = [...new Set(scenarioProvider.list().map((s) => s.strategyId))];
    return ids.map((id) => ({ value: id, label: getTemplate(id)?.shortName ?? id, sub: getTemplate(id) ? `${scenarioProvider.list({ strategyId: id }).length} scenarios` : undefined }));
  }, []);

  // Arriving from a saved strategy ("Practice") preselects its library template.
  useEffect(() => {
    if (!params.strategyId) return;
    const saved = strategies.find((s) => s.id === params.strategyId);
    const templateId = saved?.libraryId ?? params.strategyId;
    if (strategyOptions.some((o) => o.value === templateId)) setSetup({ strategyId: templateId });
  }, [params.strategyId, strategies, strategyOptions, setSetup]);

  const matching = scenarioProvider.list(filtersFor(setup)).length;
  const summary = useMemo(() => summarizePractice(attempts), [attempts]);
  const recent = useMemo(() => [...attempts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 5), [attempts]);

  const start = (mode: PracticeMode) => {
    usePracticeSetup.getState().setMode(mode);
    const pick = pickScenario(mode, setup, useAppStore.getState().practiceAttempts);
    if (!pick) return;
    router.push({ pathname: '/practice/session', params: { id: pick.scenario.id, mode, reason: pick.reason ?? '' } });
  };

  return (
    <Screen header={<AppHeader title="Practice" subtitle="Historical trading trainer" back right={<HeaderIconButton icon="stats-chart-outline" label="Practice analytics" onPress={() => router.push('/practice/analytics')} />} />}>
      <ProGate feature="practiceMode" title="Practice mode" description="Practise reading setups on historical-style scenarios before risking capital.">
        <Card>
          <View style={styles.row}>
            <Ionicons name="school" size={18} color={colors.accentBright} />
            <AppText variant="heading" style={styles.flex}>
              Decide first. Then see what happened.
            </AppText>
          </View>
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            Each scenario stops at a decision point. Choose LONG, SHORT or WAIT using your strategy rules, get a Prop Guard score, then replay the rest of the session.
          </AppText>
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <StatusBadge label="Educational sample data" tone="warning" icon="information-circle-outline" size="sm" />
            <StatusBadge label="No capital at risk" tone="positive" size="sm" />
          </View>
        </Card>

        <TileGrid>
          <MetricTile label="Practice accuracy" value={pct(summary.accuracy)} sub={`${summary.attempts} scenario${summary.attempts === 1 ? '' : 's'}`} tone={summary.accuracy == null ? 'primary' : summary.accuracy >= 0.6 ? 'positive' : 'warning'} />
          <MetricTile label="Current streak" value={String(summary.streak)} sub="correct in a row" icon="flame-outline" />
          <MetricTile label="Best strategy" value={summary.bestStrategy?.label ?? '—'} sub={summary.bestStrategy ? pct(summary.bestStrategy.accuracy) : 'Need 3+ attempts'} tone={summary.bestStrategy ? 'positive' : 'primary'} />
          <MetricTile label="Weakest strategy" value={summary.weakestStrategy?.label ?? '—'} sub={summary.weakestStrategy ? pct(summary.weakestStrategy.accuracy) : 'Need 2 strategies'} tone={summary.weakestStrategy ? 'warning' : 'primary'} />
        </TileGrid>

        <SectionHeader title="Set up your practice" />
        <Card>
          <AppText variant="label">Instrument</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Any" selected={setup.instrument == null} onPress={() => setSetup({ instrument: null })} />
            {PRACTICE_INSTRUMENTS.map((i) => (
              <Chip key={i} label={i} selected={setup.instrument === i} onPress={() => setSetup({ instrument: setup.instrument === i ? null : i })} />
            ))}
          </ScrollView>

          <View style={styles.field}>
            <SelectField
              label="Strategy"
              value={setup.strategyId ?? ANY}
              options={[{ value: ANY, label: 'All strategies', sub: 'From your Strategy Library' }, ...strategyOptions]}
              onChange={(v) => setSetup({ strategyId: v === ANY ? null : v })}
            />
          </View>

          <View style={styles.field}>
            <SegmentedControl
              label="Difficulty"
              options={[
                { value: ANY, label: 'Any' },
                { value: 'Beginner', label: 'Beginner' },
                { value: 'Intermediate', label: 'Intermediate' },
                { value: 'Advanced', label: 'Advanced' },
              ]}
              value={setup.difficulty ?? ANY}
              onChange={(v) => setSetup({ difficulty: v === ANY ? null : (v as typeof setup.difficulty) })}
            />
          </View>
          <View style={styles.field}>
            <SegmentedControl
              label="Setups"
              options={[
                { value: ANY, label: 'Both' },
                { value: 'long', label: 'Long', tone: 'positive' },
                { value: 'short', label: 'Short', tone: 'danger' },
              ]}
              value={setup.direction ?? ANY}
              onChange={(v) => setSetup({ direction: v === ANY ? null : (v as 'long' | 'short') })}
            />
          </View>
          <View style={styles.field}>
            <SegmentedControl
              label="Session"
              options={[
                { value: ANY, label: 'Any' },
                { value: 'morning', label: 'Morning' },
                { value: 'afternoon', label: 'Afternoon' },
              ]}
              value={setup.session ?? ANY}
              onChange={(v) => setSetup({ session: v === ANY ? null : (v as 'morning' | 'afternoon') })}
            />
          </View>
          <AppText variant="caption" style={{ marginTop: spacing.md }} tone={matching ? 'secondary' : 'warning'}>
            {matching ? `${matching} scenario${matching === 1 ? '' : 's'} match these filters.` : 'No scenarios match these filters yet — try fewer filters.'}
          </AppText>
        </Card>

        <Button label="Start Practice" icon="play" disabled={matching === 0} onPress={() => start('standard')} />
        <OptionCard
          icon="sparkles"
          title="Smart Practice"
          description="Prop Guard picks scenarios from your weaker areas (about 60%), mixed with average (25%) and strong areas (15%)."
          onPress={() => start('smart')}
        />
        <OptionCard icon="ribbon-outline" title="Great Setups" description="Clean, textbook examples for learning what strong setups look like. You still decide before the reveal." onPress={() => start('great')} />

        <SectionHeader title="Recent practice" action={attempts.length ? 'Analytics' : undefined} onAction={() => router.push('/practice/analytics')} />
        {recent.length === 0 ? (
          <AppText variant="caption">Your practice attempts will appear here. Every result is saved to build your personal practice statistics.</AppText>
        ) : (
          <Card>
            {recent.map((a, i) => (
              <View key={a.id} style={[styles.hist, i > 0 && styles.border]}>
                <StatusBadge label={a.grade} tone={GRADE_TONE[a.grade]} size="sm" />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {a.strategyName} · {a.instrument}
                  </AppText>
                  <AppText variant="caption">
                    {a.decision.toUpperCase()} (ideal {a.idealDecision.toUpperCase()}) · {RESULT[a.result]} · {a.score}/100
                  </AppText>
                </View>
                <AppText variant="caption" tone="tertiary">
                  {shortDate(a.timestamp)}
                </AppText>
              </View>
            ))}
          </Card>
        )}

        <OptionCard icon="images-outline" title="Practice on your own chart" description="Upload a screenshot and check it against a saved strategy's conditions." onPress={() => router.push('/practice/screenshot')} />

        <AppText variant="caption" tone="tertiary">
          {SAMPLE_DATA_NOTE} {PRACTICE_DISCLAIMER}
        </AppText>
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  chips: { gap: spacing.sm, marginTop: spacing.sm },
  field: { marginTop: spacing.lg },
  hist: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
