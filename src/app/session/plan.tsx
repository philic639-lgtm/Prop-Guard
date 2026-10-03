import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, DetailTable, EmptyState, Screen, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { draftNumbers, useSetupEvaluation } from '@/features/session/useSetupEvaluation';
import { useActiveAccount } from '@/hooks/useAppData';
import { GRADE_LABEL } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/utils/id';
import { money, price, rr } from '@/utils/format';

/** Save the planned trade before execution so the trader commits to it in advance. */
export default function SavePlanScreen() {
  const draft = useAppStore((s) => s.draft);
  const savePlan = useAppStore((s) => s.savePlan);
  const account = useActiveAccount();
  const { risk, evaluation, strategy } = useSetupEvaluation(draft);
  const [saved, setSaved] = useState(false);

  if (!draft || !account || !risk || !risk.valid || !evaluation || !strategy) {
    return (
      <Screen header={<AppHeader title="Trade plan" back />}>
        <EmptyState icon="document-outline" title="Nothing to save" message="Enter a valid entry, stop and strategy first." actionLabel="Back to check trade" onAction={() => router.replace('/analyze')} />
      </Screen>
    );
  }

  const n = draftNumbers(draft);
  const counted = evaluation.checks.filter((c) => c.severity !== 'context');
  const met = counted.filter((c) => c.passed).length;
  const compliant = evaluation.violations.length === 0;

  const save = () => {
    savePlan({
      id: draft.planId ?? uuid(),
      accountId: account.id,
      strategyId: strategy.id,
      instrument: draft.instrument,
      direction: draft.direction,
      entry: n.entry!,
      stop: n.stop!,
      target: n.target,
      contracts: n.contracts ?? 1,
      riskDollars: risk.riskDollars!,
      rewardDollars: risk.rewardDollars,
      rr: risk.rr,
      matchPct: evaluation.matchPct,
      grade: evaluation.grade,
      conditionsMet: met,
      conditionsTotal: counted.length,
      notes: draft.notes?.trim() ?? '',
      status: 'saved',
      createdAt: new Date().toISOString(),
    });
    setSaved(true);
  };

  return (
    <Screen
      header={<AppHeader title="Trade plan" back />}
      footer={
        saved ? (
          <>
            <Button label="Back to Check Trade" onPress={() => router.dismissTo('/analyze')} />
            <Button label="Done" variant="ghost" onPress={() => router.dismissTo('/home')} />
          </>
        ) : (
          <Button label="Save Plan" icon="bookmark" onPress={save} />
        )
      }>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">Save trade plan</AppText>
        <AppText variant="body" tone="secondary">
          Review your plan before execution. Commit to the numbers now — not in the heat of the trade.
        </AppText>
      </View>

      <Card>
        <View style={styles.head}>
          <AppText variant="heading" style={styles.flex}>
            {strategy.name}
          </AppText>
          <StatusBadge label={GRADE_LABEL[evaluation.grade]} tone={compliant ? 'positive' : 'danger'} size="sm" />
        </View>
        <DetailTable
          rows={[
            { label: 'Direction', value: draft.direction === 'long' ? 'LONG' : 'SHORT', tone: draft.direction === 'long' ? 'positive' : 'danger' },
            { label: 'Entry', value: price(n.entry) },
            { label: 'Stop', value: price(n.stop) },
            { label: 'Target', value: price(n.target) },
            { label: 'Contracts', value: String(n.contracts) },
            { label: 'Risk', value: money(risk.riskDollars), tone: compliant ? 'primary' : 'danger' },
            { label: 'Reward', value: money(risk.rewardDollars), tone: 'positive' },
            { label: 'R:R', value: rr(risk.rr) },
            { label: 'Strategy match', value: `${met}/${counted.length}`, tone: met === counted.length ? 'positive' : 'warning' },
          ]}
        />
      </Card>

      <Card tone={compliant ? 'positive' : 'danger'}>
        <View style={styles.head}>
          <Ionicons name={compliant ? 'checkmark-circle' : 'close-circle'} size={20} color={compliant ? colors.positive : colors.danger} />
          <AppText variant="label" tone={compliant ? 'positive' : 'danger'}>
            {compliant ? 'Plan compliant' : 'Risk or rule limit exceeded'}
          </AppText>
        </View>
        <AppText variant="body" style={{ marginTop: spacing.xs }}>
          {compliant ? 'This trade is within your saved risk limits.' : evaluation.violations[0]}
        </AppText>
      </Card>

      <Card>
        <View style={styles.head}>
          <Ionicons name="information-circle" size={18} color={colors.accentBright} />
          <AppText variant="caption" style={styles.flex}>
            Execute this trade on your trading platform, then return to Prop Guard to log the entry and start the live monitor.
          </AppText>
        </View>
      </Card>

      {saved ? (
        <Card tone="positive">
          <View style={styles.head}>
            <Ionicons name="checkmark-done-circle" size={22} color={colors.positive} />
            <AppText variant="heading">Plan saved</AppText>
          </View>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            Find it under Saved Trade Plans on the Check Trade screen.
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  flex: { flex: 1 },
});
