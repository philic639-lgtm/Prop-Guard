import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { AppHeader, AppText, Button, Card, HeaderIconButton, OptionCard, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { LibraryCard } from '@/features/strategy/LibraryCard';
import { useActiveStrategy } from '@/hooks/useAppData';
import { strategyRules } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement, useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function StrategyTab() {
  const strategies = useAppStore((s) => s.strategies);
  const setActive = useAppStore((s) => s.setActiveStrategy);
  const active = useActiveStrategy();
  const plan = useSubscriptionStore((s) => s.plan);
  const unlimitedCustom = useEntitlement('customStrategies');
  const libraryLimit = PLANS[plan].limits.libraryTemplates;
  const canAdd = unlimitedCustom || strategies.length < PLANS[plan].limits.customStrategies;
  const preview = active ? strategyRules(active) : [];
  const others = strategies.filter((s) => s.id !== active?.id);

  const gate = (path: Parameters<typeof router.push>[0]) => router.push(canAdd ? path : '/paywall');

  return (
    <Screen tabBar header={<AppHeader title="Strategies" right={<HeaderIconButton icon="school-outline" label="Practice mode" onPress={() => router.push('/practice')} />} />}>
      {active ? (
        <>
          <SectionHeader title="Active strategy" />
          <Card onPress={() => router.push({ pathname: '/strategy/review', params: { id: active.id } })}>
            <View style={styles.head}>
              <AppText variant="title" style={styles.flex} numberOfLines={1}>
                {active.name}
              </AppText>
              <StatusBadge label="Active" tone="positive" size="sm" />
            </View>
            <AppText variant="label" style={{ marginTop: spacing.xs }}>
              {active.markets.join(' · ')} • {active.session || 'Any session'}
            </AppText>
            <View style={styles.rules}>
              {preview.slice(0, 5).map((r, i) => (
                <View key={r.id} style={styles.ruleRow}>
                  <View style={styles.num}>
                    <AppText variant="caption" style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                      {i + 1}
                    </AppText>
                  </View>
                  <AppText variant="body" style={styles.flex} numberOfLines={1}>
                    {r.label}
                  </AppText>
                </View>
              ))}
              {preview.length > 5 ? (
                <AppText variant="caption" tone="accent">
                  +{preview.length - 5} more rules
                </AppText>
              ) : null}
            </View>
            <View style={styles.btnRow}>
              <Button label="Edit rules" variant="secondary" size="md" icon="create-outline" style={styles.flex} onPress={() => router.push({ pathname: '/strategy/review', params: { id: active.id } })} />
              <Button label="Practice" variant="secondary" size="md" icon="school-outline" style={styles.flex} onPress={() => router.push({ pathname: '/practice', params: { strategyId: active.id } })} />
            </View>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Build a strategy" />
      <OptionCard icon="shield-checkmark-outline" title="I have a strategy" description="Describe your plan in plain English. AI turns it into measurable rules." onPress={() => gate('/strategy/describe')} />
      <OptionCard icon="sparkles" title="Help me build a strategy" description="Create a structured plan from your account, risk limits and preferences." selected onPress={() => gate('/strategy/generating')} />
      <OptionCard icon="compass-outline" title="Find something repeatable" description="Answer a few questions and compare matching templates." onPress={() => router.push('/strategy/finder')} />

      {others.length > 0 ? (
        <>
          <SectionHeader title="Saved strategies" />
          {others.map((s) => (
            <Card key={s.id} onPress={() => router.push({ pathname: '/strategy/review', params: { id: s.id } })}>
              <View style={styles.head}>
                <View style={styles.flex}>
                  <AppText variant="heading">{s.name}</AppText>
                  <AppText variant="caption">
                    {s.markets.join(' · ')} · {s.checklist.length} conditions · min 1:{s.minRR}
                  </AppText>
                </View>
                <Button label="Use" size="md" variant="ghost" onPress={() => setActive(s.id)} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <SectionHeader title="Strategy library" action="View all" onAction={() => router.push('/strategy/library')} />
      {STRATEGY_LIBRARY.slice(0, 4).map((t, i) => (
        <LibraryCard key={t.id} template={t} locked={i >= libraryLimit} />
      ))}
      <Disclaimer text={LIBRARY_DISCLAIMER} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  rules: { marginTop: spacing.md, gap: spacing.sm },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  num: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
});
