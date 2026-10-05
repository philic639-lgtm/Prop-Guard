import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { AnalysisProgress, ANALYSIS_STEPS, IdeaCard, ImprovedStrategyCard, SuggestionCard } from '@/features/strategy/analysis/AnalysisCards';
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
import { DefinitionScoreCard, OwnershipCard, ResolveRuleSheet, ResolveSummaryCard, TestReadyCard } from '@/features/strategy/analysis/ResolveRules';
import { useResolvedStrategy } from '@/features/strategy/useResolvedStrategy';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { allRules, effectiveFields, improvedChecklist, improvedTexts, originalChecklist, toStrategy, type StrategyRuleItem } from '@/lib/engines';
import { aiService } from '@/services/ai';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';

const STEP_MS = 420;

/** Strategy Intelligence: analyse the trader's own description, then resolve and improve it together. */
export default function StrategyAnalysisScreen() {
  const text = useStrategyAnalysisStore((s) => s.text);
  const setAnalysis = useStrategyAnalysisStore((s) => s.setAnalysis);
  const decide = useStrategyAnalysisStore((s) => s.decide);
  const resolveItem = useStrategyAnalysisStore((s) => s.resolve);
  const unresolve = useStrategyAnalysisStore((s) => s.unresolve);
  const { analysis, resolved, items, progress, readiness, ownership, score, rules, savedId, error, setError, practicing, save, practiceOwnRules, testInPractice, accountMaxTrades } = useResolvedStrategy();
  const [step, setStep] = useState(analysis ? ANALYSIS_STEPS.length : 0);
  const [tab, setTab] = useState<AnalyzerTab>('dna');
  const [openId, setOpenId] = useState<string | null>(null);
  // Only a fresh analysis plays the stage animation; a restored one (Finish later) opens directly.
  const requested = useRef(false);

  // Analyse exactly the submitted text (never an example or a template).
  useEffect(() => {
    if (!text.trim() || (analysis && analysis.originalText === text)) return;
    let alive = true;
    requested.current = true;
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
  }, [text, analysis, setAnalysis, setError]);

  useEffect(() => {
    if (analysis && !requested.current) setStep(ANALYSIS_STEPS.length);
  }, [analysis]);

  // Stage ticker: shows each pipeline stage; the result appears once all stages are shown and the analysis is ready.
  useEffect(() => {
    if (step >= ANALYSIS_STEPS.length) return;
    const t = setTimeout(() => setStep((s) => (s === ANALYSIS_STEPS.length - 1 && !analysis ? s : s + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [step, analysis]);

  const checklist = useMemo(() => (resolved ? improvedChecklist(resolved, { accountMaxTrades }) : []), [resolved, accountMaxTrades]);
  const original = useMemo(() => (analysis ? originalChecklist(analysis) : []), [analysis]);
  // The sheet always shows the live item (its status updates as soon as the trader resolves it).
  const openItem: StrategyRuleItem | null = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  if (!text.trim()) {
    return (
      <Screen header={<AppHeader title="Strategy analysis" back />}>
        <EmptyState icon="sparkles-outline" title="Nothing to analyze" message="Describe your strategy first." actionLabel="Describe my strategy" onAction={() => router.replace('/strategy/describe')} />
      </Screen>
    );
  }

  const ready = !!analysis && step >= ANALYSIS_STEPS.length;
  const pending = resolved?.aiSuggestedRules.filter((s) => s.status === 'pending').length ?? 0;
  const fields = resolved ? effectiveFields(resolved) : null;
  const blocker = fields && !fields.instrument.length ? 'Resolve which market you trade before saving.' : null;

  const fineTune = () => {
    if (!analysis) return;
    const s = toStrategy(analysis, { id: savedId ?? uuid(), now: new Date().toISOString(), accountMaxTrades });
    useStrategyDraftStore.getState().setDraft(s, 'describe', analysis.analysisSource);
    router.push('/strategy/review');
  };

  const openFinal = () => router.push('/strategy/final');
  const finishLater = () => {
    // Progress is persisted with the analysis; an already-saved strategy is updated too.
    if (savedId) save();
    setOpenId(null);
    router.back();
  };

  return (
    <Screen
      header={<AppHeader title="Strategy analysis" subtitle={ready ? resolved!.name : 'Teach Prop Guard your plan'} back />}
      footer={
        ready ? (
          <View style={{ gap: spacing.sm }}>
            <Button
              label={savedId ? 'UPDATE MY STRATEGY' : 'SAVE AS MY STRATEGY'}
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

      {ready && analysis && resolved && score && rules && readiness && ownership ? (
        <>
          <IdeaCard a={resolved} />
          <DefinitionScoreCard baseline={analysis.strategyHealthScore} current={score} />
          {readiness.ready ? (
            <TestReadyCard readiness={readiness} score={score.total} onViewFinal={openFinal} onTest={testInPractice} />
          ) : null}
          {progress.total > progress.resolved || !readiness.ready ? (
            <ResolveSummaryCard
              progress={progress}
              onResolveNext={() => progress.next && setOpenId(progress.next.id)}
              onViewAll={() => setTab('dna')}
              onFinishLater={finishLater}
            />
          ) : null}
          <OwnershipCard ownership={ownership} uniquenessNote={analysis.uniqueness?.notes.join(' ')} />

          <AnalyzerTabBar value={tab} onChange={setTab} />
          {tab === 'dna' ? <DnaTab a={resolved} items={items} onResolve={(i) => setOpenId(i.id)} /> : null}
          {tab === 'weaknesses' ? <WeaknessesTab a={resolved} /> : null}
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
              {resolved.aiSuggestedRules
                .filter((s) => s.scope !== 'account')
                .map((s) => (
                  <SuggestionCard key={s.id} s={s} onDecide={(status, edited) => decide(s.id, status, edited)} />
                ))}
              {resolved.aiSuggestedRules.some((s) => s.scope === 'account') ? (
                <AppText variant="label" style={{ marginTop: spacing.sm }}>
                  ACCOUNT-WIDE PROTECTIONS · apply to every strategy, not part of this one’s logic
                </AppText>
              ) : null}
              {resolved.aiSuggestedRules
                .filter((s) => s.scope === 'account')
                .map((s) => (
                  <SuggestionCard key={s.id} s={s} onDecide={(status, edited) => decide(s.id, status, edited)} />
                ))}
              <View style={styles.bulk}>
                <Button label={`Accept all ${pending} pending`} size="md" variant="ghost" disabled={!pending} onPress={() => resolved.aiSuggestedRules.filter((s) => s.status === 'pending').forEach((s) => decide(s.id, 'accepted'))} />
              </View>
            </>
          ) : null}
          {tab === 'rules' ? <TestableRulesTab rules={rules} /> : null}
          {tab === 'best' ? <BestConditionsTab a={resolved} /> : null}
          {tab === 'avoid' ? <AvoidWhenTab a={resolved} /> : null}
          {tab === 'practice' ? <PracticeTab rules={rules} onPractice={practiceOwnRules} busy={practicing} /> : null}

          {blocker ? (
            <AppText variant="caption" tone="warning" align="center">
              {blocker}
            </AppText>
          ) : null}
          <Button label="Fine-tune rules before saving" icon="create-outline" variant="ghost" size="md" onPress={fineTune} />
          <AppText variant="caption" tone="tertiary">
            Prop Guard measures how well-defined a plan is. A higher definition score means more measurable, testable rules — it says nothing about future results. Only Historical Practice shows how a plan behaved in the past.
          </AppText>
        </>
      ) : null}
      <ResolveRuleSheet
        item={openItem}
        progress={progress}
        onClose={() => setOpenId(null)}
        onResolve={(input) => openItem && resolveItem(openItem, input)}
        onUnresolve={() => {
          if (openItem) unresolve(openItem.id);
          setOpenId(null);
        }}
        onNext={() => setOpenId(progress.next?.id ?? null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ bulk: { alignItems: 'flex-end' } });
