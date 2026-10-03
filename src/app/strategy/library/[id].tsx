import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Metric, RuleChecklist, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { strategyFromTemplate } from '@/features/strategy/fromTemplate';
import { useStrategyDraftStore } from '@/features/strategy/useStrategyDraftStore';
import { useAppStore } from '@/store/useAppStore';
import { formatClock } from '@/utils/dates';

export default function TemplateDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = getTemplate(id);
  if (!t) {
    return (
      <Screen header={<AppHeader title="Template" back />}>
        <EmptyState title="Template not found" message="This template is no longer available." />
      </Screen>
    );
  }
  return (
    <Screen
      header={<AppHeader title="Educational template" back />}
      footer={
        <Button
          label="Use this strategy"
          icon="add-circle-outline"
          onPress={() => {
            const markets = useAppStore.getState().preferences.markets;
            useStrategyDraftStore.getState().setDraft(strategyFromTemplate(t, markets), 'template', 'local');
            router.replace('/strategy/review');
          }}
        />
      }>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="title">{t.name}</AppText>
        <View style={styles.badges}>
          <StatusBadge label={t.complexity} size="sm" />
          <StatusBadge label={t.style} tone="accent" size="sm" />
        </View>
        <AppText variant="body" tone="secondary">
          {t.summary}
        </AppText>
      </View>
      <Card>
        <View style={styles.grid}>
          <Metric label="Markets" value={t.markets.join(', ')} compact />
          <Metric label="Session" value={t.session} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Timeframes" value={t.timeframes} compact />
          <Metric
            label="Window"
            value={t.defaults.entryWindowStart ? `${formatClock(t.defaults.entryWindowStart)}–${formatClock(t.defaults.entryWindowEnd)}` : 'Any'}
            compact
          />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Stop" value={t.stopMethod} compact />
          <Metric label="Target" value={t.targetStyle} compact />
        </View>
      </Card>
      <SectionHeader title="Rules" />
      <Card>
        {t.rules.map((r, i) => (
          <AppText key={r} variant="body" style={{ marginTop: i ? spacing.sm : 0 }}>
            {i + 1}. {r}
          </AppText>
        ))}
      </Card>
      <SectionHeader title="Checklist" />
      <Card>
        <RuleChecklist rows={t.checklist.map((c) => ({ id: c, label: c, state: 'pending' as const }))} />
      </Card>
      <AppText variant="caption" tone="tertiary">
        {LIBRARY_DISCLAIMER}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', gap: spacing.sm },
  grid: { flexDirection: 'row', gap: spacing.md },
});
