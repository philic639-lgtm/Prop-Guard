import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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
import { PRACTICE_DISCLAIMER, SAMPLE_DATA_NOTE, SIMULATED_DATA_NOTE, VERIFIED_DATA_NOTE } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { PRACTICE_INSTRUMENTS } from '@/data/practice/scenarioFactory';
import { GRADE_TONE } from '@/features/practice/components/PracticeScoreCard';
import { filtersFor, pickScenario, usePracticeSetup, type PracticeMode } from '@/features/practice/selection';
import { summarizePractice } from '@/lib/engines';
import { scenarioProvider } from '@/services/marketHistory';
import { generateCustomStrategyScenarios, getVerifiedPractice, hasCustomScenarios, onVerifiedScenariosChange, simulatedReady, simulatedScenarios } from '@/services/marketHistory/historical';
import { loadVerifiedScenarios } from '@/services/marketHistory/remote';
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
  const params = useLocalSearchParams<{ strategyId?: string; source?: string; fromAnalysis?: 'exact' | 'closest' | 'none' | 'own' }>();
  const attempts = useAppStore((s) => s.practiceAttempts);
  const strategies = useAppStore((s) => s.strategies);
  const setup = usePracticeSetup((s) => s.setup);
  const setSetup = usePracticeSetup((s) => s.setSetup);
  const historical = setup.source === 'historical';
  // Bumped when verified scenarios load or simulated scenarios finish generating.
  const [dataVersion, setDataVersion] = useState(0);
  const historicalReady = !historical || simulatedReady();

  // Verified historical scenarios are generated server-side; load them when Supabase is configured.
  useEffect(() => {
    const off = onVerifiedScenariosChange(() => setDataVersion((v) => v + 1));
    loadVerifiedScenarios().catch(() => undefined);
    return () => {
      off();
    };
  }, []);

  // Simulated scenarios run the real detection rules on generated bars — build them off the first frame.
  useEffect(() => {
    if (!historical || simulatedReady()) return;
    const t = setTimeout(() => {
      simulatedScenarios();
      setDataVersion((v) => v + 1);
    }, 30);
    return () => clearTimeout(t);
  }, [historical]);

  const catalog = useMemo(
    () => (historicalReady ? scenarioProvider.list({ source: setup.source }) : []),
    // dataVersion invalidates the list when scenarios load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historicalReady, setup.source, dataVersion],
  );
  const verifiedCount = useMemo(() => (historical ? getVerifiedPractice().length : 0), [historical, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Strategies come from the Strategy Library; only those with practice scenarios are offered.
  const strategyOptions = useMemo(() => {
    const ids = [...new Set(catalog.map((s) => s.strategyId))];
    return ids.map((id) => ({ value: id, label: getTemplate(id)?.shortName ?? catalog.find((s) => s.strategyId === id)?.strategyName ?? id, sub: `${catalog.filter((s) => s.strategyId === id).length} scenarios` }));
  }, [catalog]);
  const instrumentOptions = useMemo(() => (historical ? [...new Set(catalog.map((s) => s.instrument))] : [...PRACTICE_INSTRUMENTS]), [historical, catalog]);

  const setSource = (source: 'samples' | 'historical') => setSetup({ source, strategyId: null, instrument: null, difficulty: null });

  // Arriving from Strategy Analysis ("Test in Historical Practice") switches to historical data.
  useEffect(() => {
    if (params.source === 'historical' && usePracticeSetup.getState().setup.source !== 'historical') setSetup({ source: 'historical', strategyId: null, instrument: null, difficulty: null });
  }, [params.source, setSetup]);

  // A saved custom strategy with testable rules practises on scenarios found by ITS OWN rules (SIMULATED data).
  useEffect(() => {
    const saved = strategies.find((s) => s.id === params.strategyId);
    const rules = saved?.structured?.testableRules;
    if (!saved || saved.libraryId || !rules?.coverage.testable || hasCustomScenarios(saved.id)) return;
    // Registering notifies onVerifiedScenariosChange subscribers, which refreshes the catalog.
    generateCustomStrategyScenarios(saved.id, saved.name, rules);
    setSetup({ source: 'historical' });
  }, [params.strategyId, strategies, setSetup]);

  // Arriving from a saved strategy ("Practice") preselects its library template.
  useEffect(() => {
    if (!params.strategyId) return;
    const saved = strategies.find((s) => s.id === params.strategyId);
    const templateId = saved?.libraryId ?? params.strategyId;
    if (strategyOptions.some((o) => o.value === templateId)) setSetup({ strategyId: templateId });
  }, [params.strategyId, strategies, strategyOptions, setSetup]);

  const matching = historicalReady ? scenarioProvider.list(filtersFor(setup)).length : 0;
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
            {historical
              ? 'The chart freezes at the decision candle. Choose LONG, SHORT or SKIP, set entry, stop and target, lock your decision — then the future is revealed and scored.'
              : 'Each scenario stops at a decision point. Choose LONG, SHORT or WAIT using your strategy rules, get a Prop Guard score, then replay the rest of the session.'}
          </AppText>
          <View style={[styles.row, { marginTop: spacing.md }]}>
            {!historical ? (
              <StatusBadge label="Educational sample data" tone="warning" icon="information-circle-outline" size="sm" />
            ) : verifiedCount > 0 ? (
              <StatusBadge label={`${verifiedCount} verified historical`} tone="positive" icon="shield-checkmark" size="sm" />
            ) : (
              <StatusBadge label="SIMULATED data" tone="warning" icon="flask-outline" size="sm" />
            )}
            <StatusBadge label="No capital at risk" tone="positive" size="sm" />
          </View>
        </Card>

        {params.fromAnalysis === 'own' ? (
          <Card tone="accent">
            <AppText variant="body">
              These SIMULATED scenarios were found by running YOUR rules on simulated price data — not recorded market history. Rules marked “confirm visually” in your testable rules were not checked automatically.
            </AppText>
          </Card>
        ) : null}
        {params.fromAnalysis === 'none' || params.fromAnalysis === 'closest' ? (
          <Card tone="warning">
            <AppText variant="body">
              {params.fromAnalysis === 'none'
                ? 'Your strategy is saved. Historical Practice does not have scenarios for this exact strategy type yet, so none is preselected — practise related setups, or use your strategy with screenshot practice.'
                : 'Your strategy is saved. Historical Practice is showing the closest matching structure (not your exact rules) — check the strategy name on each scenario.'}
            </AppText>
          </Card>
        ) : null}

        <TileGrid>
          <MetricTile label="Practice accuracy" value={pct(summary.accuracy)} sub={`${summary.attempts} scenario${summary.attempts === 1 ? '' : 's'}`} tone={summary.accuracy == null ? 'primary' : summary.accuracy >= 0.6 ? 'positive' : 'warning'} />
          <MetricTile label="Current streak" value={String(summary.streak)} sub="correct in a row" icon="flame-outline" />
          <MetricTile label="Best strategy" value={summary.bestStrategy?.label ?? '—'} sub={summary.bestStrategy ? pct(summary.bestStrategy.accuracy) : 'Need 3+ attempts'} tone={summary.bestStrategy ? 'positive' : 'primary'} />
          <MetricTile label="Weakest strategy" value={summary.weakestStrategy?.label ?? '—'} sub={summary.weakestStrategy ? pct(summary.weakestStrategy.accuracy) : 'Need 2 strategies'} tone={summary.weakestStrategy ? 'warning' : 'primary'} />
        </TileGrid>

        <SectionHeader title="Set up your practice" />
        <Card>
          <SegmentedControl
            label="Data source"
            options={[
              { value: 'samples', label: 'Samples' },
              { value: 'historical', label: 'Historical' },
            ]}
            value={setup.source}
            onChange={(v) => setSource(v as 'samples' | 'historical')}
          />
          {historical ? (
            <AppText variant="caption" tone={verifiedCount ? 'secondary' : 'warning'} style={{ marginTop: spacing.sm }}>
              {verifiedCount
                ? `${verifiedCount} verified historical scenarios are available, plus SIMULATED scenarios for practice. Each scenario is labelled.`
                : 'No verified market data is connected yet. Historical mode runs the real strategy rules on SIMULATED bars — clearly labelled, never presented as real history.'}
            </AppText>
          ) : null}
          <AppText variant="label" style={styles.field}>
            Instrument
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="Any" selected={setup.instrument == null} onPress={() => setSetup({ instrument: null })} />
            {instrumentOptions.map((i) => (
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
            {!historicalReady
              ? 'Preparing simulated historical scenarios…'
              : matching
                ? `${matching} scenario${matching === 1 ? '' : 's'} match these filters.`
                : 'No scenarios match these filters yet — try fewer filters.'}
          </AppText>
        </Card>

        <Button label="Start Practice" icon="play" disabled={matching === 0} onPress={() => start('standard')} />
        <OptionCard
          icon="sparkles"
          title="Smart Practice"
          description="Prop Guard picks scenarios from your weaker areas (about 60%), mixed with average (25%) and strong areas (15%)."
          onPress={() => start('smart')}
        />
        <OptionCard
          icon="ribbon-outline"
          title="Great Setups"
          description={historical ? 'Curated educational examples of strong setups (sample data). You still decide before the reveal.' : 'Clean, textbook examples for learning what strong setups look like. You still decide before the reveal.'}
          onPress={() => start('great')}
        />

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
          {historical ? (verifiedCount ? VERIFIED_DATA_NOTE : SIMULATED_DATA_NOTE) : SAMPLE_DATA_NOTE} {PRACTICE_DISCLAIMER}
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
