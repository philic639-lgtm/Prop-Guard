import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { StrategyCard } from '@/components/domain/StrategyCard';
import { AppHeader, AppText, Button, Card, EmptyState, HeaderIconButton, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement, useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function StrategyTab() {
  const strategies = useAppStore((s) => s.strategies);
  const activeId = useAppStore((s) => s.activeStrategyId);
  const plan = useSubscriptionStore((s) => s.plan);
  const unlimitedCustom = useEntitlement('customStrategies');
  const libraryLimit = PLANS[plan].limits.libraryTemplates;
  const canAdd = unlimitedCustom || strategies.length < PLANS[plan].limits.customStrategies;

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          title="Strategies"
          right={<HeaderIconButton icon="add" label="New strategy" onPress={() => router.push(canAdd ? '/strategy/new' : '/paywall')} />}
        />
      }>
      <SectionHeader title="Your strategy" />
      {strategies.length === 0 ? (
        <Card>
          <EmptyState
            icon="git-branch-outline"
            title="Define your edge"
            message="Write down the rules you already trade. Prop Guard will hold you to them."
            actionLabel="Build my strategy"
            onAction={() => router.push('/strategy/new')}
          />
        </Card>
      ) : (
        strategies.map((s) => (
          <StrategyCard key={s.id} strategy={s} active={s.id === activeId} onPress={() => router.push({ pathname: '/strategy/[id]', params: { id: s.id } })} />
        ))
      )}

      <Card tone="accent">
        <View style={styles.row}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
          <AppText variant="label" tone="accent">
            AI Strategy Finder
          </AppText>
        </View>
        <AppText variant="heading" style={{ marginTop: spacing.sm }}>
          Find something repeatable
        </AppText>
        <AppText variant="caption">Answer a few questions about how you trade. We&apos;ll suggest structures that fit your style.</AppText>
        <Button label="Find my strategy" size="md" onPress={() => router.push('/strategy/finder')} style={{ marginTop: spacing.lg }} />
      </Card>

      <SectionHeader title="Strategy library" action="View all" onAction={() => router.push('/strategy/library')} />
      {STRATEGY_LIBRARY.map((t, i) => {
        const locked = i >= libraryLimit;
        return (
          <Card
            key={t.id}
            onPress={() => router.push(locked ? '/paywall' : { pathname: '/strategy/library/[id]', params: { id: t.id } })}
            accessibilityLabel={`${t.name}${locked ? ', Pro' : ''}`}>
            <View style={styles.libRow}>
              <View style={styles.flex}>
                <AppText variant="heading">{t.name}</AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {t.session} · {t.timeframes}
                </AppText>
              </View>
              {locked ? <Ionicons name="lock-closed" size={16} color={colors.textTertiary} /> : <StatusBadge label={t.complexity} tone="neutral" size="sm" />}
            </View>
          </Card>
        );
      })}
      <Disclaimer text={LIBRARY_DISCLAIMER} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  libRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, gap: 2 },
});
