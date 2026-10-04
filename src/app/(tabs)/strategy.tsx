import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { AppHeader, AppText, Button, Card, HeaderIconButton, OptionCard, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { StrategyPerformanceCard } from '@/features/strategy/StrategyPerformanceCard';
import { useAccountTrades, useActiveStrategy } from '@/hooks/useAppData';
import { performanceInsight, strategyPerformance, strategyRules, strategySourceLabel } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement, useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function StrategyTab() {
  const strategies = useAppStore((s) => s.strategies);
  const setActive = useAppStore((s) => s.setActiveStrategy);
  const active = useActiveStrategy();
  const plan = useSubscriptionStore((s) => s.plan);
  const unlimitedCustom = useEntitlement('customStrategies');
  const canAdd = unlimitedCustom || strategies.length < PLANS[plan].limits.customStrategies;
  const preview = active ? strategyRules(active) : [];
  const others = strategies.filter((s) => s.id !== active?.id);
  const trades = useAccountTrades();
  const performance = useMemo(() => strategyPerformance(trades, strategies), [trades, strategies]);

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
            <AppText variant="caption" tone="accent" style={{ marginTop: 2 }}>
              {strategySourceLabel(active)}
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
      <OptionCard icon="shield-checkmark-outline" title="I have a strategy" description="Describe any strategy in plain English. Prop Guard analyzes it, finds vague rules and helps make it measurable." onPress={() => gate('/strategy/describe')} />
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
                  <AppText variant="label" style={{ fontSize: 10, marginTop: 2 }}>
                    {strategySourceLabel(s)}
                  </AppText>
                </View>
                <Button label="Use" size="md" variant="ghost" onPress={() => setActive(s.id)} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <SectionHeader title="Explore strategies" />
      <Card onPress={() => router.push('/strategy/library')} accessibilityLabel="Strategy Library — browse rule-based frameworks">
        <View style={styles.head}>
          <View style={styles.exploreIcon}>
            <Ionicons name="library-outline" size={20} color={colors.accentBright} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">Strategy Library</AppText>
            <AppText variant="caption">Browse {STRATEGY_LIBRARY.length}+ rule-based trading frameworks.</AppText>
          </View>
        </View>
        <Button label="Open Strategy Library" icon="arrow-forward" variant="secondary" size="md" style={{ marginTop: spacing.md }} onPress={() => router.push('/strategy/library')} />
      </Card>

      {performance.length > 0 ? (
        <>
          <SectionHeader title="Your strategy performance" action="Details" onAction={() => router.push('/performance')} />
          <StrategyPerformanceCard rows={performance} insight={performanceInsight(performance)} limit={4} />
        </>
      ) : null}

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
  exploreIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
});
