import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, AppText, Button, Card, Chip, LoadingState, Screen, StatusBadge } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { CATEGORY_LABEL, getTemplate } from '@/data/strategyLibrary';
import { openTemplateInAnalyze } from '@/features/strategy/templateActions';
import type { FinderAnswers } from '@/lib/engines';
import { aiService, type StrategyRecommendation } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';

const MARKETS = ['ES', 'MES', 'NQ', 'MNQ', 'YM', 'MYM', 'RTY', 'M2K', 'CL', 'MCL', 'GC', 'MGC', 'SI', 'HG', '6E', '6B', 'ZN', 'OTHER'];

type SingleKey = Exclude<keyof FinderAnswers, 'instruments' | 'dailyRisk'>;
const QUESTIONS: { key: SingleKey; title: string; options: { value: string; label: string }[] }[] = [
  {
    key: 'session',
    title: 'When do you normally trade?',
    options: [
      { value: 'ny_open', label: 'NY Open' },
      { value: 'ny_morning', label: 'NY Morning' },
      { value: 'ny_afternoon', label: 'NY Afternoon' },
      { value: 'london', label: 'London' },
      { value: 'asia', label: 'Asia' },
      { value: 'flexible', label: 'Flexible' },
    ],
  },
  {
    key: 'style',
    title: 'What type of trading feels most natural?',
    options: [
      { value: 'breakout', label: 'Breakouts' },
      { value: 'pullback', label: 'Pullbacks' },
      { value: 'reversal', label: 'Reversals' },
      { value: 'trend', label: 'Trend following' },
      { value: 'support_resistance', label: 'Support/resistance' },
      { value: 'unsure', label: 'I’m not sure' },
    ],
  },
  {
    key: 'patience',
    title: 'How patient are you?',
    options: [
      { value: 'frequent', label: 'I want frequent setups' },
      { value: 'quality', label: '1–2 quality setups' },
      { value: 'selective', label: 'Very selective' },
    ],
  },
  {
    key: 'holdTime',
    title: 'How long do you usually hold trades?',
    options: [
      { value: '1-5', label: '1–5 minutes' },
      { value: '5-20', label: '5–20 minutes' },
      { value: '20-60', label: '20–60 minutes' },
      { value: '60+', label: 'Longer' },
    ],
  },
  {
    key: 'environment',
    title: 'What market environment do you prefer?',
    options: [
      { value: 'trending', label: 'Trending' },
      { value: 'range', label: 'Range' },
      { value: 'high_volatility', label: 'High volatility' },
      { value: 'low_volatility', label: 'Low volatility' },
      { value: 'any', label: 'No preference' },
    ],
  },
  {
    key: 'riskReward',
    title: 'Preferred risk/reward?',
    options: [
      { value: '1', label: '1:1' },
      { value: '1.5', label: '1:1.5' },
      { value: '2', label: '1:2' },
      { value: '3', label: '1:3+' },
      { value: 'unsure', label: 'Not sure' },
    ],
  },
  {
    key: 'experience',
    title: 'Experience level?',
    options: [
      { value: 'Beginner', label: 'Beginner' },
      { value: 'Intermediate', label: 'Intermediate' },
      { value: 'Advanced', label: 'Advanced' },
    ],
  },
];
const TOTAL = QUESTIONS.length + 1;

/** "Find Something Repeatable": ranks Prop Guard's curated library — it never invents strategies. */
export default function StrategyFinder() {
  const markets = useAppStore((s) => s.preferences.markets);
  const dailyRisk = useAppStore((s) => s.tradingRules.dailyStop);
  const [step, setStep] = useState(0);
  const [instruments, setInstruments] = useState<string[]>(() => markets.filter((m) => MARKETS.includes(m)));
  const [answers, setAnswers] = useState<Partial<FinderAnswers>>({});
  const [results, setResults] = useState<StrategyRecommendation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);

  const submit = async (final: Partial<FinderAnswers>) => {
    setLoading(true);
    try {
      setResults(await aiService.recommendStrategies({ ...(final as FinderAnswers), instruments: instruments.length ? instruments : ['OTHER'], dailyRisk }));
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setResults(null);
    setStep(0);
    setAnswers({});
    setCompare([]);
  };

  const content = () => {
    if (loading) return <LoadingState label="Ranking the strategy library for you…" />;
    if (results) {
      const [best, ...rest] = results;
      const bestT = best ? getTemplate(best.templateId) : undefined;
      return (
        <>
          {bestT && best ? (
            <Card tone="accent">
              <StatusBadge label="Best match" tone="accent" icon="sparkles" />
              <View style={styles.resHead}>
                <View style={styles.flex}>
                  <AppText variant="title">{bestT.shortName}</AppText>
                  <AppText variant="label" style={{ fontSize: 10 }}>
                    {CATEGORY_LABEL[bestT.category]}
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText variant="number" tone="accent">
                    {best.fitScore}%
                  </AppText>
                  <AppText variant="label" style={{ fontSize: 9 }}>
                    Match
                  </AppText>
                </View>
              </View>
              <AppText variant="label" style={{ marginTop: spacing.md, fontSize: 10 }}>
                Why it fits you
              </AppText>
              {best.reasons.map((reason) => (
                <View key={reason} style={styles.reason}>
                  <Ionicons name="checkmark" size={16} color={colors.positive} />
                  <AppText variant="body" style={styles.flex}>
                    {reason}
                  </AppText>
                </View>
              ))}
              <Cautions items={best.cautions} />
              <ResultActions id={best.templateId} compare={compare} setCompare={setCompare} primary />
            </Card>
          ) : null}

          {rest.map((r, i) => {
            const t = getTemplate(r.templateId);
            if (!t) return null;
            return (
              <Card key={r.templateId}>
                <View style={styles.resHead}>
                  <AppText variant="heading" style={styles.flex}>
                    #{i + 2} {t.shortName}
                  </AppText>
                  <AppText variant="bodyStrong" tone="accent">
                    {r.fitScore}%
                  </AppText>
                </View>
                <AppText variant="caption" style={{ marginTop: spacing.xs }} numberOfLines={2}>
                  {r.reasons.slice(0, 3).join(' · ')}
                </AppText>
                <Cautions items={r.cautions} />
                <ResultActions id={r.templateId} compare={compare} setCompare={setCompare} />
              </Card>
            );
          })}

          {compare.length >= 2 ? (
            <Button label={`Compare ${compare.length} strategies`} icon="git-compare-outline" onPress={() => router.push({ pathname: '/strategy/compare', params: { ids: compare.join(',') } })} />
          ) : (
            <AppText variant="caption" align="center">
              Tap Compare on two or three results to see them side by side.
            </AppText>
          )}
          <AppText variant="caption" tone="tertiary">
            Match % describes how well a framework’s structure fits your answers — not how it will perform. {LIBRARY_DISCLAIMER}
          </AppText>
          <Button label="Start over" variant="ghost" onPress={restart} />
        </>
      );
    }

    if (step === 0) {
      return (
        <>
          <AppText variant="title">What do you trade?</AppText>
          <AppText variant="caption">Select all that apply.</AppText>
          <View style={styles.options}>
            {MARKETS.map((m) => (
              <Chip
                key={m}
                large
                label={m === 'OTHER' ? 'Other' : m}
                selected={instruments.includes(m)}
                onPress={() => setInstruments((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
              />
            ))}
          </View>
          <Button label="Next" icon="arrow-forward" disabled={instruments.length === 0} onPress={() => setStep(1)} />
        </>
      );
    }

    const q = QUESTIONS[step - 1];
    return (
      <>
        <AppText variant="title">{q.title}</AppText>
        <View style={styles.options}>
          {q.options.map((o) => (
            <Chip
              key={o.value}
              large
              label={o.label}
              selected={answers[q.key] === o.value}
              onPress={() => {
                const next = { ...answers, [q.key]: o.value };
                setAnswers(next);
                if (step === QUESTIONS.length) void submit(next);
                else setStep((s) => s + 1);
              }}
            />
          ))}
        </View>
      </>
    );
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Find something repeatable"
          subtitle={results ? 'Your top 5 matches' : `Question ${step + 1} of ${TOTAL}`}
          back
          onBack={step > 0 && !results ? () => setStep((s) => s - 1) : undefined}
        />
      }>
      <ProGate feature="aiStrategyFinder" title="Strategy Finder" description="Answer a few questions and Prop Guard ranks its built-in strategy library for how you trade.">
        {content()}
      </ProGate>
    </Screen>
  );
}

function Cautions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: spacing.sm, gap: 4 }}>
      {items.map((c) => (
        <View key={c} style={styles.reason}>
          <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
          <AppText variant="caption" style={styles.flex}>
            {c}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function ResultActions({ id, compare, setCompare, primary }: { id: string; compare: string[]; setCompare: (f: (c: string[]) => string[]) => void; primary?: boolean }) {
  const t = getTemplate(id)!;
  const selected = compare.includes(id);
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
      {primary ? <Button label="Try this strategy" size="md" icon="play" onPress={() => openTemplateInAnalyze(t)} /> : null}
      <View style={styles.actions}>
        {!primary ? <Button label="Try" size="md" variant="secondary" style={styles.flex} onPress={() => openTemplateInAnalyze(t)} /> : null}
        <Button label="View rules" size="md" variant="secondary" style={styles.flex} onPress={() => router.push({ pathname: '/strategy/library/[id]', params: { id } })} />
        <Button
          label={selected ? 'Comparing' : 'Compare'}
          icon={selected ? 'checkmark' : 'git-compare-outline'}
          size="md"
          variant={selected ? 'primary' : 'secondary'}
          style={styles.flex}
          disabled={!selected && compare.length >= 3}
          onPress={() => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(0, 3)))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  resHead: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  reason: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
