import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, ChoiceGrid, DetailTable, NumericInput, Screen, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useActiveAccount } from '@/hooks/useAppData';
import { accountLimits, assessPersonality, markLesson, rulesFromPersonality } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';
import type { PersonalityAnswers } from '@/types/domain';
import { money, parseNum } from '@/utils/format';

type Choice = Exclude<keyof PersonalityAnswers, 'riskPerTrade' | 'dailyLoss'>;

const QUESTIONS: { key: Choice; title: string; columns?: number; options: { value: string; label: string; sub?: string }[] }[] = [
  {
    key: 'hours',
    title: 'How much time can you trade each day?',
    columns: 2,
    options: [
      { value: 'lt1', label: 'Under 1 hour' },
      { value: '1to2', label: '1–2 hours' },
      { value: '2to4', label: '2–4 hours' },
      { value: 'gt4', label: '4+ hours' },
    ],
  },
  {
    key: 'session',
    title: 'When can you trade?',
    columns: 2,
    options: [
      { value: 'ny_open', label: 'NY open', sub: '9:30–10:30 ET' },
      { value: 'ny_morning', label: 'NY morning', sub: '10:30–12:00 ET' },
      { value: 'ny_afternoon', label: 'Afternoon', sub: '13:00–16:00 ET' },
      { value: 'flexible', label: 'Flexible' },
    ],
  },
  {
    key: 'afterLoss',
    title: 'After a losing trade, you usually…',
    columns: 1,
    options: [
      { value: 'revenge', label: 'Want to win it back right away' },
      { value: 'frustrated', label: 'Feel frustrated but keep going' },
      { value: 'calm', label: 'Stay calm and follow the plan' },
    ],
  },
  {
    key: 'openLoss',
    title: 'Watching a trade go against you is…',
    columns: 1,
    options: [
      { value: 'uncomfortable', label: 'Very uncomfortable — I like tight stops' },
      { value: 'okay', label: 'Fine within my plan' },
      { value: 'comfortable', label: 'Comfortable — I give trades room' },
    ],
  },
  {
    key: 'frequency',
    title: 'How often do you want to trade?',
    columns: 3,
    options: [
      { value: 'frequent', label: 'Often', sub: 'several a day' },
      { value: 'quality', label: '1–2 a day' },
      { value: 'selective', label: 'Rarely', sub: 'only the best' },
    ],
  },
  {
    key: 'hold',
    title: 'How long do you want to hold a trade?',
    columns: 2,
    options: [
      { value: '1-5', label: '1–5 min' },
      { value: '5-20', label: '5–20 min' },
      { value: '20-60', label: '20–60 min' },
      { value: '60+', label: 'Over an hour' },
    ],
  },
  {
    key: 'experience',
    title: 'Your trading experience',
    columns: 3,
    options: [
      { value: 'Beginner', label: 'New' },
      { value: 'Intermediate', label: 'Some' },
      { value: 'Advanced', label: 'Experienced' },
    ],
  },
];

/** Trading personality — deterministic, uses only the trader's answers and their account's limits. */
export default function PersonalityScreen() {
  const existing = useAppStore((s) => s.preferences.learning?.personality ?? null);
  const tradingRules = useAppStore((s) => s.tradingRules);
  const updateLearning = useAppStore((s) => s.updateLearning);
  const setTradingRules = useAppStore((s) => s.setTradingRules);
  const account = useActiveAccount();
  const limits = useMemo(() => accountLimits(account), [account]);

  const [answers, setAnswers] = useState<Partial<Record<Choice, string>>>(existing?.answers ?? {});
  const [risk, setRisk] = useState(existing ? String(existing.answers.riskPerTrade) : '');
  const [daily, setDaily] = useState(existing ? String(existing.answers.dailyLoss) : '');
  const [showResult, setShowResult] = useState(!!existing);
  const [applied, setApplied] = useState(false);

  const riskN = parseNum(risk);
  const dailyN = parseNum(daily);
  const complete = QUESTIONS.every((q) => answers[q.key]) && riskN != null && riskN > 0 && dailyN != null && dailyN > 0;

  const submit = () => {
    if (!complete) return;
    const a = { ...(answers as Record<Choice, string>), riskPerTrade: riskN!, dailyLoss: dailyN! } as PersonalityAnswers;
    const result = assessPersonality(a, new Date(), limits);
    updateLearning((p) => ({ ...markLesson(p, 'personality-assessment', 'completed', new Date()), personality: result }));
    setApplied(false);
    setShowResult(true);
  };

  const result = showResult ? existing : null;

  if (result) {
    const r = result.suggestedRules;
    return (
      <Screen header={<AppHeader title="Your trading personality" back />}>
        <Card raised style={styles.gap}>
          <StatusBadge label="Your profile" tone="accent" size="sm" />
          <AppText variant="title">{result.archetype}</AppText>
          <AppText variant="body" tone="secondary">
            {result.summary}
          </AppText>
          <View style={styles.traits}>
            {result.traits.map((t) => (
              <StatusBadge key={t} label={t} size="sm" />
            ))}
          </View>
        </Card>

        <DetailTable
          title="Rules built from your answers"
          rows={[
            { label: 'Max risk per trade', value: money(r.maxRiskPerTrade), bold: true },
            { label: 'Daily stop', value: money(r.dailyStop), bold: true },
            { label: 'Max trades per day', value: String(r.maxTradesPerDay) },
            { label: 'Cooldown after a loss', value: `${r.cooldownMinutes} min` },
            { label: 'Stop after consecutive losses', value: String(r.maxConsecutiveLosses) },
          ]}
        />
        <AppText variant="caption" tone="tertiary">
          These come from the limits you entered — tightened (never raised) to fit {account ? `${account.name}’s rules` : 'your account once you add it'}.
        </AppText>

        {result.cautions.length ? (
          <Card tone="warning" style={styles.gap}>
            <AppText variant="label">Watch for</AppText>
            {result.cautions.map((c) => (
              <AppText key={c} variant="caption" tone="secondary">
                • {c}
              </AppText>
            ))}
          </Card>
        ) : null}

        <Button
          label={applied ? 'Rules applied' : 'Use these as my risk rules'}
          icon={applied ? 'checkmark' : 'shield-checkmark-outline'}
          variant={applied ? 'success' : 'primary'}
          disabled={applied}
          onPress={() => {
            setTradingRules(rulesFromPersonality(tradingRules, result));
            setApplied(true);
          }}
        />
        <Button label="See matching strategies" variant="secondary" icon="compass-outline" onPress={() => router.push('/learn/strategies')} />
        <Button label="Retake the assessment" variant="ghost" onPress={() => setShowResult(false)} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title="Trading personality" subtitle="2 minutes · no right or wrong answers" back />}
      footer={<Button label={complete ? 'See my profile' : 'Answer every question'} icon="person-outline" disabled={!complete} onPress={submit} />}>
      {QUESTIONS.map((q) => (
        <ChoiceGrid
          key={q.key}
          label={q.title}
          columns={q.columns}
          options={q.options}
          value={answers[q.key] ?? null}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
        />
      ))}
      <View style={styles.gap}>
        <AppText variant="label">Your own risk limits</AppText>
        <View style={styles.row}>
          <View style={styles.flex}>
            <NumericInput label="Most I’ll risk on one trade" prefix="$" value={risk} onChangeText={setRisk} placeholder={String(tradingRules.maxRiskPerTrade)} />
          </View>
          <View style={styles.flex}>
            <NumericInput label="Most I’ll lose in a day" prefix="$" value={daily} onChangeText={setDaily} placeholder={String(tradingRules.dailyStop)} />
          </View>
        </View>
        <AppText variant="caption" tone="tertiary">
          {limits?.dailyLossLimit != null
            ? `${account?.name} allows ${money(limits.dailyLossLimit)} a day — your numbers will be kept inside it.`
            : 'Your numbers are kept inside your account’s limits once you add it.'}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  traits: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
