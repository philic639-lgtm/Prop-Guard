import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppHeader, AppText, Button, Card, ConfirmationSheet, Screen } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useStrategyAnalysisStore } from '@/features/strategy/useStrategyAnalysisStore';
import { confirmedPlan, planReadiness, scorePlan, type StrategyPlan } from '@/lib/engines/strategyPlan';
import { useAppStore } from '@/store/useAppStore';
import type { Strategy } from '@/types/domain';
import { goBack } from '@/utils/navigation';

import { ConfirmedPlanCard, PlanScoreCard } from './PlanCards';

/** A saved plan (from "Teach Prop Guard your plan"): the confirmed rules with their sources; edited on the plan screen. */
export function PlanStrategyView({ strategy, plan }: { strategy: Strategy; plan: StrategyPlan }) {
  const activeId = useAppStore((s) => s.activeStrategyId);
  const setActive = useAppStore((s) => s.setActiveStrategy);
  const remove = useAppStore((s) => s.deleteStrategy);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readiness = planReadiness(plan);
  const draft = readiness.status === 'draft';
  const edit = () => {
    useStrategyAnalysisStore.getState().loadPlan(plan, strategy.id);
    router.push('/strategy/analysis');
  };
  return (
    <Screen
      header={<AppHeader title={strategy.name} subtitle={draft ? 'Draft plan' : 'Your plan'} back />}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label="EDIT PLAN" icon="create-outline" onPress={edit} />
          {!draft && activeId !== strategy.id ? <Button label="Use as my active strategy" variant="secondary" size="md" onPress={() => setActive(strategy.id)} /> : null}
        </View>
      }>
      <ConfirmedPlanCard lines={confirmedPlan(plan)} draft={draft} unresolved={readiness.unresolved} />
      <PlanScoreCard score={scorePlan(plan)} />
      <Card style={{ gap: spacing.xs }}>
        <AppText variant="label">YOUR ORIGINAL DESCRIPTION</AppText>
        <AppText variant="caption" tone="secondary">
          {plan.originalText}
        </AppText>
      </Card>
      <Button label="Delete strategy" variant="ghost" size="md" onPress={() => setConfirmDelete(true)} />
      <ConfirmationSheet
        visible={confirmDelete}
        title="Delete this strategy?"
        message="Its plan and answers are removed. Trades keep their history."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove(strategy.id);
          goBack('/strategy');
        }}
      />
    </Screen>
  );
}
