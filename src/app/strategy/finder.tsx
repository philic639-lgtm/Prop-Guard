import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, AppText, Button, Card, Chip, LoadingState, NumericInput, Screen, StatusBadge } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { useActiveAccount } from '@/hooks/useAppData';
import { aiService, type StrategyFinderAnswers, type StrategyRecommendation } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';
import { parseNum } from '@/utils/format';

type Choice<K extends keyof StrategyFinderAnswers> = { value: StrategyFinderAnswers[K]; label: string };

const QUESTIONS: {
  key: 'market' | 'tradesPerDay' | 'session' | 'style' | 'stopSize' | 'target' | 'preference';
  title: string;
  options: Choice<keyof StrategyFinderAnswers>[];
}[] = [
  { key: 'market', title: 'What market do you trade?', options: [{ value: 'ES', label: 'ES' }, { value: 'MES', label: 'MES' }, { value: 'NQ', label: 'NQ' }, { value: 'MNQ', label: 'MNQ' }] },
  { key: 'tradesPerDay', title: 'How many trades per day?', options: [{ value: '1', label: '1' }, { value: '2-3', label: '2–3' }, { value: '4+', label: '4+' }] },
  { key: 'session', title: 'Preferred trading session?', options: [{ value: 'open', label: 'The open' }, { value: 'morning', label: 'Morning' }, { value: 'any', label: 'Flexible' }] },
  { key: 'style', title: 'Scalping or intraday?', options: [{ value: 'scalp', label: 'Scalping' }, { value: 'intraday', label: 'Intraday' }] },
  { key: 'stopSize', title: 'Preferred stop size (ES points)?', options: [{ value: 'tight', label: 'Tight (2–5)' }, { value: 'medium', label: 'Medium (4–8)' }, { value: 'wide', label: 'Wide (7–12)' }] },
  { key: 'target', title: 'Preferred target?', options: [{ value: '1.5R', label: '1.5R' }, { value: '2R', label: '2R' }, { value: '3R', label: '3R' }] },
  {
    key: 'preference',
    title: 'What do you prefer?',
    options: [
      { value: 'breakout', label: 'Breakouts' },
      { value: 'pullback', label: 'Pullbacks' },
      { value: 'reversal', label: 'Reversals' },
      { value: 'trend', label: 'Trend following' },
      { value: 'unsure', label: 'Not sure' },
    ],
  },
];

export default function StrategyFinder() {
  const account = useActiveAccount();
  const rules = useAppStore((s) => s.tradingRules);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<StrategyFinderAnswers>>({});
  const [accountSize, setAccountSize] = useState(String(account?.size ?? 25000));
  const [dailyRisk, setDailyRisk] = useState(String(rules.dailyStop));
  const [results, setResults] = useState<StrategyRecommendation[] | null>(null);
  const [loading, setLoading] = useState(false);

  const total = QUESTIONS.length + 1;
  const q = QUESTIONS[step];

  const submit = async () => {
    setLoading(true);
    try {
      const recs = await aiService.recommendStrategies({
        ...(answers as StrategyFinderAnswers),
        accountSize: parseNum(accountSize) ?? 25000,
        dailyRisk: parseNum(dailyRisk) ?? 400,
      });
      setResults(recs);
    } finally {
      setLoading(false);
    }
  };

  const content = () => {
    if (loading) return <LoadingState label="Matching your preferences…" />;
    if (results) {
      return (
        <>
          <AppText variant="caption">{LIBRARY_DISCLAIMER}</AppText>
          {results.map((r, i) => {
            const t = getTemplate(r.templateId);
            if (!t) return null;
            return (
              <Card key={r.templateId} tone={i === 0 ? 'accent' : undefined}>
                {i === 0 ? <StatusBadge label="Your match" tone="accent" icon="sparkles" /> : null}
                <View style={styles.resHead}>
                  <AppText variant="title" style={styles.flex}>
                    {t.name}
                  </AppText>
                  <AppText variant="number" tone="accent">
                    {Math.round(r.fitScore)}%
                  </AppText>
                </View>
                <AppText variant="label" style={{ marginTop: spacing.md, fontSize: 10 }}>
                  Why it fits you
                </AppText>
                {r.reasons.map((reason) => (
                  <View key={reason} style={styles.reason}>
                    <Ionicons name="checkmark" size={16} color={colors.positive} />
                    <AppText variant="body" style={styles.flex}>
                      {reason}
                    </AppText>
                  </View>
                ))}
                <Button
                  label="Use this strategy"
                  size="md"
                  variant={i === 0 ? 'primary' : 'secondary'}
                  style={{ marginTop: spacing.lg }}
                  onPress={() => router.replace({ pathname: '/strategy/[id]', params: { id: 'new', template: t.id } })}
                />
              </Card>
            );
          })}
          <Button label="Start over" variant="ghost" onPress={() => { setResults(null); setStep(0); setAnswers({}); }} />
        </>
      );
    }
    if (q) {
      return (
        <>
          <AppText variant="title">{q.title}</AppText>
          <View style={styles.options}>
            {q.options.map((o) => (
              <Chip
                key={String(o.value)}
                large
                label={o.label}
                selected={answers[q.key] === o.value}
                onPress={() => {
                  setAnswers((a) => ({ ...a, [q.key]: o.value }));
                  setStep((s) => s + 1);
                }}
              />
            ))}
          </View>
        </>
      );
    }
    return (
      <>
        <AppText variant="title">Account size and daily risk tolerance?</AppText>
        <NumericInput label="Account size" prefix="$" value={accountSize} onChangeText={setAccountSize} large />
        <NumericInput label="Daily risk tolerance" prefix="$" value={dailyRisk} onChangeText={setDailyRisk} large />
        <Button label="Find my strategy" icon="sparkles" onPress={() => void submit()} />
      </>
    );
  };

  return (
    <Screen header={<AppHeader title="Strategy finder" subtitle={results ? 'Results' : `Step ${Math.min(step + 1, total)} of ${total}`} back onBack={step > 0 && !results ? () => setStep((s) => s - 1) : undefined} />}>
      <ProGate feature="aiStrategyFinder" title="AI Strategy Finder" description="Answer a few questions and get strategy structures that match how you trade.">
        {content()}
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  resHead: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  reason: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
});
