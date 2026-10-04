import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen, SectionHeader, SelectField, StatusBadge, ToggleRow, YesNo } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { StrategyMatchCard } from '@/features/strategy/StrategyMatchCard';
import { useActiveStrategy } from '@/hooks/useAppData';
import { strategySourceLabel } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';

/**
 * Pre-trade session: pick the strategy you're trading today and work its
 * checklist. SETUP VALID only appears when every required rule is met.
 * The answers are the same ones Analyze uses, so nothing is entered twice.
 */
export default function TodaysPlan() {
  const strategies = useAppStore((s) => s.strategies);
  const draft = useAppStore((s) => s.draft);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const setDraft = useAppStore((s) => s.setDraft);
  const patchDraft = useAppStore((s) => s.patchDraft);
  const setTodayStrategy = useAppStore((s) => s.setTodayStrategy);
  const active = useActiveStrategy();
  const [invalidated, setInvalidated] = useState(false);

  const strategy = strategies.find((s) => s.id === draft?.strategyId) ?? active;

  // Keep the shared pre-trade draft pointed at today's strategy.
  useEffect(() => {
    if (!active) return;
    if (!draft) setDraft(newDraft(active, defaultInstrument));
    else if (!draft.strategyId) patchDraft({ strategyId: active.id, answers: {} });
  }, [active, draft, defaultInstrument, setDraft, patchDraft]);

  if (strategies.length === 0) {
    return (
      <Screen header={<AppHeader title="Today's plan" back />}>
        <Card>
          <EmptyState icon="git-branch-outline" title="No strategy yet" message="Save a strategy from the library or describe your own to start a pre-trade session." actionLabel="Open strategy library" onAction={() => router.push('/strategy/library')} />
        </Card>
      </Screen>
    );
  }

  const answers = draft?.answers ?? {};
  const items = strategy?.checklist.filter((c) => c.kind === 'yesno') ?? [];

  return (
    <Screen
      header={<AppHeader title="Today's plan" back />}
      footer={
        <>
          <Button label="Check a trade" icon="shield-checkmark" onPress={() => router.push('/analyze')} />
          {strategy ? <Button label="Edit rules" variant="ghost" onPress={() => router.push({ pathname: '/strategy/review', params: { id: strategy.id } })} /> : null}
        </>
      }>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="title">Pre-trade session</AppText>
        <AppText variant="body" tone="secondary">
          Choose the strategy you&apos;re trading today, then confirm each rule as the market develops.
        </AppText>
      </View>

      <SelectField
        label="Strategy I'm trading today"
        value={strategy?.id ?? null}
        options={strategies.map((s) => ({ value: s.id, label: s.name, sub: strategySourceLabel(s) }))}
        onChange={(id) => {
          setTodayStrategy(id);
          const next = strategies.find((s) => s.id === id) ?? null;
          setDraft({ ...newDraft(next, draft?.instrument ?? defaultInstrument), instrument: draft?.instrument ?? defaultInstrument });
          setInvalidated(false);
        }}
      />

      {strategy ? (
        <>
          <View style={styles.badges}>
            <StatusBadge label={strategySourceLabel(strategy)} tone="accent" size="sm" />
            <StatusBadge label={`Min 1:${strategy.minRR}`} size="sm" />
            <StatusBadge label={`Max ${strategy.maxTrades} trade${strategy.maxTrades === 1 ? '' : 's'}`} size="sm" />
          </View>

          <SectionHeader title={`Checklist · ${items.filter((c) => answers[c.id] === true).length}/${items.length}`} />
          <Card>
            <View style={{ gap: spacing.lg }}>
              {items.map((item) => (
                <YesNo key={item.id} label={item.label} value={answers[item.id] ?? null} onChange={(v) => patchDraft({ answers: { ...answers, [item.id]: v } })} />
              ))}
              <ToggleRow
                label="Invalidation occurred"
                description={strategy.invalidationRules || 'The setup was invalidated'}
                value={invalidated}
                onChange={setInvalidated}
              />
            </View>
          </Card>

          <StrategyMatchCard strategy={strategy} answers={answers} invalidated={invalidated} />

          <AppText variant="caption" tone="tertiary" align="center">
            Prop Guard checks whether your rules are met. No setup guarantees a profitable trade.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
