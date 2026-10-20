import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen, Sheet } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { ClarifyCard, ConfirmedPlanCard, PlanScoreCard, QuestionCard, SuggestionsCard, TestingCard, UnderstoodCard } from '@/features/strategy/plan/PlanCards';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { confirmedPlan, editQuestion, planName, planQuestions, planReadiness, planSuggestions, planTestability, planToStrategy, scorePlan, understoodLines, type SavedSettings } from '@/lib/engines/strategyPlan';
import { getVerifiedHistorical } from '@/services/marketHistory/historical';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';

/**
 * "Teach Prop Guard your plan": what we understood, what needs clarification, your confirmed plan.
 * Everything on this screen comes from ONE plan model built from the trader's own words; answers and
 * accepted ideas update it, and every view, the score and the saved strategy are derived from it.
 */
export default function StrategyPlanScreen() {
  const text = useStrategyAnalysisStore((s) => s.text);
  const plan = useStrategyAnalysisStore((s) => s.plan);
  const savedId = useStrategyAnalysisStore((s) => s.savedId);
  const answer = useStrategyAnalysisStore((s) => s.answerPlan);
  const decide = useStrategyAnalysisStore((s) => s.decidePlanSuggestion);
  const markets = useAppStore((s) => s.preferences.markets);
  const rules = useAppStore((s) => s.tradingRules);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Older saved progress has text but no plan yet.
  useEffect(() => {
    useStrategyAnalysisStore.getState().ensurePlan();
  }, [text]);

  // Settings the trader already saved — offered for reuse, applied only when picked.
  const saved: SavedSettings = useMemo(
    () => ({ markets, maxTradesPerDay: rules.maxTradesPerDay || null, maxConsecutiveLosses: rules.maxConsecutiveLosses || null, dailyStop: rules.dailyStop || null, maxRiskPerTrade: rules.maxRiskPerTrade || null }),
    [markets, rules],
  );
  const views = useMemo(() => {
    if (!plan) return null;
    const instruments = plan.fields.instrument.value ?? [];
    const verified = getVerifiedHistorical().filter((h) => !instruments.length || instruments.includes(h.instrument)).length;
    return {
      understood: understoodLines(plan),
      questions: planQuestions(plan, saved),
      confirmed: confirmedPlan(plan),
      score: scorePlan(plan),
      readiness: planReadiness(plan),
      suggestions: planSuggestions(plan),
      testability: planTestability(plan, verified),
    };
  }, [plan, saved]);

  if (!text.trim() || !plan || !views) {
    return (
      <Screen header={<AppHeader title="Your strategy plan" back />}>
        <EmptyState icon="sparkles-outline" title="Nothing to analyze" message="Describe your strategy first." actionLabel="Describe my strategy" onAction={() => router.replace('/strategy/describe')} />
      </Screen>
    );
  }

  const draft = views.readiness.status === 'draft';
  const save = (): string | null => {
    const id = savedId ?? uuid();
    const st = useAppStore.getState();
    const existing = st.strategies.find((x) => x.id === id);
    const strategy = planToStrategy(plan, { id, now: new Date().toISOString(), name: existing?.name, createdAt: existing?.createdAt });
    if (!strategy.name.trim()) {
      setError('Name the strategy first.');
      return null;
    }
    setError(null);
    st.upsertStrategy(strategy);
    // A draft never becomes the active trading strategy on its own.
    if (!st.activeStrategyId && !draft) st.setActiveStrategy(strategy.id);
    useStrategyAnalysisStore.getState().setSavedId(strategy.id);
    return strategy.id;
  };
  const practice = () => {
    save();
    router.push({ pathname: '/practice', params: { source: 'historical', fromAnalysis: 'closest', ...(plan.usesOpeningRange ? { strategyId: 'orb-15' } : {}) } });
  };
  const editQ = editing ? editQuestion(plan, editing, saved) : null;

  return (
    <Screen
      header={<AppHeader title="Your strategy plan" subtitle={planName(plan)} back />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={draft ? (savedId ? 'UPDATE DRAFT' : 'SAVE AS DRAFT') : savedId ? 'UPDATE MY PLAN' : 'SAVE MY PLAN'}
            icon="save-outline"
            onPress={() => {
              const id = save();
              if (id) router.replace({ pathname: '/strategy/[id]', params: { id } });
            }}
          />
          {draft ? (
            <AppText variant="caption" tone="tertiary" align="center">
              Saved as a draft until every required rule is defined. Drafts are not used to approve trades.
            </AppText>
          ) : null}
        </View>
      }>
      {error ? (
        <Card tone="danger">
          <AppText variant="body">{error}</AppText>
        </Card>
      ) : null}
      <UnderstoodCard lines={views.understood} original={plan.originalText} onEdit={setEditing} onEditDescription={() => router.push({ pathname: '/strategy/describe', params: { edit: '1' } })} />
      <ClarifyCard questions={views.questions} onAnswer={answer} />
      <ConfirmedPlanCard lines={views.confirmed} draft={draft} unresolved={views.readiness.unresolved} />
      <PlanScoreCard score={views.score} />
      <SuggestionsCard suggestions={views.suggestions} onDecide={decide} />
      <TestingCard testability={views.testability} onPractice={practice} />

      <Sheet visible={!!editQ} onClose={() => setEditing(null)} title="Edit your plan">
        {editQ ? (
          <QuestionCard
            q={editQ}
            onAnswer={(a) => {
              answer(editQ.id, a);
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
