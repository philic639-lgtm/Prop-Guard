import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen, SectionHeader } from '@/components/ui';
import { spacing } from '@/constants/theme';
import {
  AnalysisProgress,
  ANALYSIS_STEPS,
  BehaviorCard,
  HealthCard,
  IdeaCard,
  ImprovedStrategyCard,
  NeedsWorkCard,
  QuestionCard,
  StrongCard,
  SuggestionCard,
} from '@/features/strategy/analysis/AnalysisCards';
import { practiceTemplateFor } from '@/features/strategy/practiceLink';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { effectiveFields, improvedChecklist, improvedHealth, toStrategy, validateStrategy } from '@/lib/engines';
import { aiService } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';

const STEP_MS = 420;

/** Strategy Intelligence: analyse the trader's own description, then improve it together. */
export default function StrategyAnalysisScreen() {
  const text = useStrategyAnalysisStore((s) => s.text);
  const analysis = useStrategyAnalysisStore((s) => s.analysis);
  const setAnalysis = useStrategyAnalysisStore((s) => s.setAnalysis);
  const decide = useStrategyAnalysisStore((s) => s.decide);
  const answer = useStrategyAnalysisStore((s) => s.answer);
  const accountMaxTrades = useAppStore((s) => s.tradingRules.maxTradesPerDay);
  const [step, setStep] = useState(analysis ? ANALYSIS_STEPS.length : 0);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Analyse exactly the submitted text (never an example or a template).
  useEffect(() => {
    if (!text.trim() || (analysis && analysis.originalText === text)) return;
    let alive = true;
    aiService
      .analyzeStrategy(text)
      .then((a) => alive && setAnalysis(a))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [text, analysis, setAnalysis]);

  // Stage ticker: shows each pipeline stage; the result appears once all stages are shown and the analysis is ready.
  useEffect(() => {
    if (step >= ANALYSIS_STEPS.length) return;
    const t = setTimeout(() => setStep((s) => (s === ANALYSIS_STEPS.length - 1 && !analysis ? s : s + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [step, analysis]);

  const checklist = useMemo(() => (analysis ? improvedChecklist(analysis, { accountMaxTrades }) : []), [analysis, accountMaxTrades]);
  const improved = useMemo(() => (analysis ? improvedHealth(analysis) : null), [analysis]);

  if (!text.trim()) {
    return (
      <Screen header={<AppHeader title="Strategy analysis" back />}>
        <EmptyState icon="sparkles-outline" title="Nothing to analyze" message="Describe your strategy first." actionLabel="Describe my strategy" onAction={() => router.replace('/strategy/describe')} />
      </Screen>
    );
  }

  const ready = !!analysis && step >= ANALYSIS_STEPS.length;
  const pending = analysis?.aiSuggestedRules.filter((s) => s.status === 'pending').length ?? 0;
  const fields = analysis ? effectiveFields(analysis) : null;
  const blocker = fields && !fields.instrument.length ? 'Answer which market you trade before saving.' : null;

  const save = (): string | null => {
    if (!analysis) return null;
    if (savedId) return savedId;
    const s = toStrategy(analysis, { id: uuid(), now: new Date().toISOString(), accountMaxTrades });
    const problems = validateStrategy(s);
    if (problems.length) {
      setError(problems.join(' '));
      return null;
    }
    const st = useAppStore.getState();
    st.upsertStrategy(s);
    if (!st.activeStrategyId) st.setActiveStrategy(s.id);
    setSavedId(s.id);
    return s.id;
  };

  const testInPractice = () => {
    const id = save();
    if (!id || !analysis) return;
    const link = practiceTemplateFor(analysis);
    router.push({ pathname: '/practice', params: { strategyId: link?.templateId ?? id, source: 'historical', fromAnalysis: link ? (link.exact ? 'exact' : 'closest') : 'none' } });
  };

  const fineTune = () => {
    if (!analysis) return;
    const s = toStrategy(analysis, { id: uuid(), now: new Date().toISOString(), accountMaxTrades });
    useStrategyDraftStore.getState().setDraft(s, 'describe', analysis.analysisSource);
    router.push('/strategy/review');
  };

  return (
    <Screen
      header={<AppHeader title="Strategy analysis" subtitle={ready ? analysis!.name : 'Teach Prop Guard your plan'} back />}
      footer={
        ready ? (
          <View style={{ gap: spacing.sm }}>
            <Button
              label={savedId ? 'Saved as my strategy' : 'SAVE AS MY STRATEGY'}
              icon={savedId ? 'checkmark' : 'save-outline'}
              disabled={!!blocker}
              onPress={() => {
                const id = save();
                if (id) router.replace({ pathname: '/strategy/next', params: { id } });
              }}
            />
            <Button label="TEST IN HISTORICAL PRACTICE" icon="time-outline" variant="secondary" size="md" disabled={!!blocker} onPress={testInPractice} />
          </View>
        ) : undefined
      }>
      {!ready ? <AnalysisProgress step={step} /> : null}
      {error ? (
        <Card tone="danger">
          <AppText variant="body">{error}</AppText>
        </Card>
      ) : null}

      {ready && analysis && improved ? (
        <>
          <IdeaCard a={analysis} />
          <HealthCard health={analysis.strategyHealthScore} improved={improved} />
          <StrongCard health={analysis.strategyHealthScore} />
          <NeedsWorkCard health={analysis.strategyHealthScore} />
          {analysis.unresolvedQuestions.map((q) => (
            <QuestionCard key={q.id} q={q} onAnswer={(a) => answer(q.id, a)} />
          ))}
          <BehaviorCard risks={analysis.behavioralRisks} />

          <SectionHeader title="Prop Guard suggestions" />
          <AppText variant="caption">
            Every threshold below is a Prop Guard suggestion, not your rule. Accept, edit or reject each one — only accepted or edited suggestions are saved.
          </AppText>
          {analysis.aiSuggestedRules.map((s) => (
            <SuggestionCard key={s.id} s={s} onDecide={(status, edited) => decide(s.id, status, edited)} />
          ))}
          <View style={styles.bulk}>
            <Button label={`Accept all ${pending} pending`} size="md" variant="ghost" disabled={!pending} onPress={() => analysis.aiSuggestedRules.filter((s) => s.status === 'pending').forEach((s) => decide(s.id, 'accepted'))} />
          </View>

          <ImprovedStrategyCard sections={checklist} />
          {blocker ? (
            <AppText variant="caption" tone="warning" align="center">
              {blocker}
            </AppText>
          ) : null}
          <Button label="Fine-tune rules before saving" icon="create-outline" variant="ghost" size="md" onPress={fineTune} />
          <AppText variant="caption" tone="tertiary">
            Prop Guard measures how well-defined a plan is. A higher health score means more measurable, testable rules — it says nothing about future results. Only Historical Practice shows how a plan behaved in the past.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ bulk: { alignItems: 'flex-end' } });
