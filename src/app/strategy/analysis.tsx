import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { AnalysisProgress, ANALYSIS_STEPS, HealthCard, IdeaCard, ImprovedStrategyCard, QuestionCard, SuggestionCard } from '@/features/strategy/analysis/AnalysisCards';
import {
  AnalyzerTabBar,
  AvoidWhenTab,
  BestConditionsTab,
  ComparisonView,
  DnaTab,
  PracticeTab,
  TestableRulesTab,
  WeaknessesTab,
  type AnalyzerTab,
} from '@/features/strategy/analysis/AnalysisTabs';
import { practiceTemplateFor } from '@/features/strategy/practiceLink';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { allRules, effectiveFields, improvedChecklist, improvedHealth, improvedTexts, originalChecklist, testableRulesOf, toStrategy, validateStrategy } from '@/lib/engines';
import { generateCustomStrategyScenarios } from '@/services/marketHistory/historical';
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
  const [tab, setTab] = useState<AnalyzerTab>('dna');
  const [practicing, setPracticing] = useState(false);

  // Analyse exactly the submitted text (never an example or a template).
  useEffect(() => {
    if (!text.trim() || (analysis && analysis.originalText === text)) return;
    let alive = true;
    // Earlier analysed strategies: the uniqueness test makes sure this one does not converge on them.
    const references = useAppStore
      .getState()
      .strategies.filter((st) => st.structured)
      .map((st) => ({ name: st.name, originalText: st.structured!.originalText, improved: improvedTexts(allRules(st.structured!), st.structured!.aiSuggestedRules) }));
    aiService
      .analyzeStrategy(text, { references })
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
  const original = useMemo(() => (analysis ? originalChecklist(analysis) : []), [analysis]);
  const rules = useMemo(() => (analysis ? testableRulesOf(analysis) : null), [analysis]);

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

  /** Practice on scenarios found by the trader's OWN compiled rules (simulated candles). */
  const practiceOwnRules = () => {
    const id = save();
    if (!id || !analysis || !rules?.coverage.testable) return;
    setPracticing(true);
    // Let the spinner render before the scan runs.
    setTimeout(() => {
      generateCustomStrategyScenarios(id, analysis.name, testableRulesOf(analysis));
      setPracticing(false);
      router.push({ pathname: '/practice', params: { strategyId: id, source: 'historical', fromAnalysis: 'own' } });
    }, 30);
  };

  const testInPractice = () => {
    if (rules?.coverage.testable) return practiceOwnRules();
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

      {ready && analysis && improved && rules ? (
        <>
          <IdeaCard a={analysis} />
          <HealthCard health={analysis.strategyHealthScore} improved={improved} />
          {analysis.uniqueness ? (
            <AppText variant="caption" tone={analysis.uniqueness.passes ? 'secondary' : 'warning'}>
              Identity check: {analysis.uniqueness.notes.join(' ')} ({Math.round(analysis.uniqueness.identityRetention * 100)}% of the improved plan uses your own vocabulary.)
            </AppText>
          ) : null}
          {analysis.unresolvedQuestions.map((q) => (
            <QuestionCard key={q.id} q={q} onAnswer={(a) => answer(q.id, a)} />
          ))}

          <AnalyzerTabBar value={tab} onChange={setTab} />
          {tab === 'dna' ? <DnaTab a={analysis} /> : null}
          {tab === 'weaknesses' ? <WeaknessesTab a={analysis} /> : null}
          {tab === 'improved' ? (
            <>
              <ComparisonView original={original} optimized={checklist} />
              <ImprovedStrategyCard sections={checklist} />
            </>
          ) : null}
          {tab === 'why' ? (
            <>
              <AppText variant="caption">
                Original idea → problem → Prop Guard improvement → why it helps. Thresholds are Prop Guard suggestions, not your rules: accept, edit or reject each one — only accepted or edited changes are saved.
              </AppText>
              {analysis.aiSuggestedRules
                .filter((s) => s.scope !== 'account')
                .map((s) => (
                  <SuggestionCard key={s.id} s={s} onDecide={(status, edited) => decide(s.id, status, edited)} />
                ))}
              {analysis.aiSuggestedRules.some((s) => s.scope === 'account') ? (
                <AppText variant="label" style={{ marginTop: spacing.sm }}>
                  ACCOUNT-WIDE PROTECTIONS · apply to every strategy, not part of this one’s logic
                </AppText>
              ) : null}
              {analysis.aiSuggestedRules
                .filter((s) => s.scope === 'account')
                .map((s) => (
                  <SuggestionCard key={s.id} s={s} onDecide={(status, edited) => decide(s.id, status, edited)} />
                ))}
              <View style={styles.bulk}>
                <Button label={`Accept all ${pending} pending`} size="md" variant="ghost" disabled={!pending} onPress={() => analysis.aiSuggestedRules.filter((s) => s.status === 'pending').forEach((s) => decide(s.id, 'accepted'))} />
              </View>
            </>
          ) : null}
          {tab === 'rules' ? <TestableRulesTab rules={rules} /> : null}
          {tab === 'best' ? <BestConditionsTab a={analysis} /> : null}
          {tab === 'avoid' ? <AvoidWhenTab a={analysis} /> : null}
          {tab === 'practice' ? <PracticeTab rules={rules} onPractice={practiceOwnRules} busy={practicing} /> : null}

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
