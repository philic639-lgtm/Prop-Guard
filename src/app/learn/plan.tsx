import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, DetailTable, EmptyState, Screen, SegmentedControl, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { finderAnswersFromProfile } from '@/features/strategy/finderProfile';
import { saveTemplate } from '@/features/strategy/templateActions';
import { useActiveAccount } from '@/hooks/useAppData';
import { buildTradingPlan, markLesson, recommendStrategies } from '@/lib/engines/learningEngine';
import { matchTemplates } from '@/lib/engines/strategyLibraryEngine';
import { useAppStore } from '@/store/useAppStore';
import type { InstrumentSymbol } from '@/types/domain';
import { money } from '@/utils/format';

/** Personal trading plan: personality + chosen framework + account limits, sized with the risk engine. */
export default function PlanScreen() {
  const params = useLocalSearchParams<{ templateId?: string }>();
  const prefs = useAppStore((s) => s.preferences);
  const rules = useAppStore((s) => s.tradingRules);
  const updateLearning = useAppStore((s) => s.updateLearning);
  const setTradingRules = useAppStore((s) => s.setTradingRules);
  const setActiveStrategy = useAppStore((s) => s.setActiveStrategy);
  const account = useActiveAccount();
  const personality = prefs.learning?.personality ?? null;
  const saved = prefs.learning?.plan ?? null;

  const templateId = useMemo(() => {
    if (params.templateId && getTemplate(params.templateId)) return params.templateId;
    if (saved?.templateId) return saved.templateId;
    const top = personality ? recommendStrategies(personality.answers, prefs.markets, 1) : matchTemplates(finderAnswersFromProfile(prefs, rules), 1);
    return top[0]?.templateId ?? null;
  }, [params.templateId, saved?.templateId, personality, prefs, rules]);
  const template = getTemplate(templateId);

  const instruments = useMemo(() => {
    const list = (prefs.markets.length ? prefs.markets : [prefs.defaultInstrument]).slice(0, 4);
    return list.includes(prefs.defaultInstrument) ? list : [prefs.defaultInstrument, ...list].slice(0, 4);
  }, [prefs.markets, prefs.defaultInstrument]);
  // Start on the first contract this plan can actually size (e.g. MES when one ES contract is too much risk).
  const [instrument, setInstrument] = useState<InstrumentSymbol>(
    () =>
      (template && instruments.find((i) => buildTradingPlan({ personality, template, instrument: i, account, rules }).sizing.contracts !== 0)) ??
      instruments[0] ??
      'MES',
  );

  const plan = useMemo(
    () => (template ? buildTradingPlan({ personality, template, instrument, account, rules }) : null),
    [personality, template, instrument, account, rules],
  );
  const [appliedId, setAppliedId] = useState<string | null>(saved?.templateId === templateId ? saved.strategyId : null);

  if (!template || !plan) {
    return (
      <Screen header={<AppHeader title="My trading plan" back />}>
        <EmptyState icon="map-outline" title="Choose a strategy first" message="Pick a framework that fits you." actionLabel="See matches" onAction={() => router.push('/learn/strategies')} />
      </Screen>
    );
  }

  const apply = () => {
    const strategy = saveTemplate(template);
    setActiveStrategy(strategy.id);
    if (personality) setTradingRules(plan.rules);
    const now = new Date();
    updateLearning((p) => ({ ...markLesson(p, 'plan-builder', 'completed', now), plan: { templateId: template.id, strategyId: strategy.id, appliedAt: now.toISOString() } }));
    setAppliedId(strategy.id);
  };

  const r = plan.rules;
  return (
    <Screen header={<AppHeader title="My trading plan" subtitle="PLAN YOUR TRADE." back />}>
      <Card raised style={styles.gap}>
        {plan.archetype ? <StatusBadge label={plan.archetype} tone="accent" size="sm" /> : null}
        <AppText variant="title">{plan.title}</AppText>
        <AppText variant="caption" tone="secondary">
          {plan.strategy.setup}
        </AppText>
        <Button label="Change strategy" variant="ghost" onPress={() => router.push('/learn/strategies')} />
      </Card>

      {instruments.length > 1 ? (
        <SegmentedControl label="Contract" options={instruments.map((s) => ({ value: s, label: s }))} value={instrument} onChange={setInstrument} />
      ) : null}

      <DetailTable
        title="The setup"
        rows={[
          { label: 'When', value: plan.strategy.entryWindow ? `${plan.strategy.entryWindow[0]}–${plan.strategy.entryWindow[1]} ET` : plan.strategy.sessionLabel },
          { label: 'Entry', value: plan.strategy.entryTrigger },
          { label: 'Stop', value: plan.strategy.stopLoss },
          { label: 'Target', value: plan.strategy.profitTarget },
        ]}
      />

      <DetailTable
        title={personality ? 'Risk rules (from your assessment)' : 'Risk rules (your current rules)'}
        rows={[
          { label: 'Max risk per trade', value: money(r.maxRiskPerTrade), bold: true },
          { label: 'Daily stop', value: money(r.dailyStop), bold: true },
          { label: 'Max trades per day', value: String(r.maxTradesPerDay) },
          { label: 'Cooldown after a loss', value: `${r.cooldownMinutes} min` },
          { label: 'Stop after losses in a row', value: String(r.maxConsecutiveLosses) },
        ]}
      />

      <Card style={styles.gap}>
        <AppText variant="label">Position size</AppText>
        {plan.sizing.stopPoints ? (
          <AppText variant="bodyStrong">
            Typical stop {plan.sizing.stopPoints[0]}–{plan.sizing.stopPoints[1]} pts → up to {plan.sizing.contracts} {instrument}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="secondary">
          {plan.sizing.note}
        </AppText>
      </Card>

      {plan.account ? (
        <DetailTable
          title={`${plan.account.name}${plan.account.verified ? ' · verified firm rules' : ' · entered manually'}`}
          rows={[
            {
              label: 'Daily loss limit',
              value: plan.account.dailyLossMode === 'none' ? 'None (verified)' : plan.account.dailyLossLimit != null ? money(plan.account.dailyLossLimit) : 'Not set',
            },
            { label: 'Max drawdown', value: plan.account.maxDrawdown != null ? money(plan.account.maxDrawdown) : 'Not set' },
            { label: 'Max contracts', value: plan.account.maxContracts != null ? String(plan.account.maxContracts) : 'Not set' },
          ]}
        />
      ) : (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="bodyStrong">Add your prop account</AppText>
          <AppText variant="caption" tone="secondary">
            Its verified loss limits become part of this plan.
          </AppText>
          <Button label="Add account" variant="secondary" onPress={() => router.push('/accounts/new')} />
        </Card>
      )}

      <Card style={styles.gap}>
        <AppText variant="label">Pre-trade checklist</AppText>
        {plan.checklist.map((c) => (
          <AppText key={c} variant="caption">
            ☐ {c}
          </AppText>
        ))}
      </Card>

      <Card style={styles.gap}>
        <AppText variant="label">Daily routine</AppText>
        {(['before', 'during', 'after'] as const).map((k) => (
          <View key={k} style={styles.gapSm}>
            <AppText variant="bodyStrong">{k === 'before' ? 'Before the session' : k === 'during' ? 'During' : 'After'}</AppText>
            {plan.routine[k].map((x) => (
              <AppText key={x} variant="caption" tone="secondary">
                • {x}
              </AppText>
            ))}
          </View>
        ))}
      </Card>

      {plan.cautions.length ? (
        <Card tone="warning" style={styles.gap}>
          <AppText variant="label">Check before trading</AppText>
          {plan.cautions.map((c) => (
            <AppText key={c} variant="caption" tone="secondary">
              • {c}
            </AppText>
          ))}
        </Card>
      ) : null}

      {appliedId ? (
        <Card tone="positive" style={styles.gap}>
          <AppText variant="heading">Plan saved</AppText>
          <AppText variant="caption" tone="secondary">
            {template.shortName} is your active strategy{personality ? ' and your risk rules are updated' : ''}. Practise it before trading it.
          </AppText>
          <Button label="Practice this plan" icon="flask-outline" onPress={() => router.push({ pathname: '/practice', params: { strategyId: appliedId } })} />
          <Button label="Check a trade" variant="secondary" icon="shield-checkmark-outline" onPress={() => router.push('/analyze')} />
        </Card>
      ) : (
        <Button label={personality ? 'Save plan & apply my rules' : 'Save plan'} icon="checkmark" onPress={apply} />
      )}

      <AppText variant="caption" tone="tertiary">
        {plan.disclaimer}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  gapSm: { gap: 2 },
});
