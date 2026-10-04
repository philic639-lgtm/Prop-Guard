import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, HeaderIconButton, Metric, RuleChecklist, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import {
  CATEGORY_LABEL,
  CONDITION_LABEL,
  FRAMEWORK_LABEL,
  FREQUENCY_LABEL,
  HOLD_LABEL,
  SESSION_LABEL,
  getTemplate,
  type StrategyTemplate,
} from '@/data/strategyLibrary';
import { COMPLEXITY_TONE, windowLabel } from '@/features/strategy/LibraryCard';
import { StrategyVisualExample } from '@/features/strategy/StrategyVisualExample';
import { customizeTemplate, openTemplateInAnalyze, practiceTemplate, saveTemplate, savedStrategyFor } from '@/features/strategy/templateActions';
import { strategyPerformance } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { rMultiple } from '@/utils/format';

export default function TemplateDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = getTemplate(id);
  if (!t) {
    return (
      <Screen header={<AppHeader title="Strategy" back />}>
        <EmptyState title="Strategy not found" message="This template is no longer available." />
      </Screen>
    );
  }
  return <Detail t={t} />;
}

function Detail({ t }: { t: StrategyTemplate }) {
  const strategies = useAppStore((s) => s.strategies);
  const trades = useAppStore((s) => s.trades);
  const saved = savedStrategyFor(t.id, strategies);
  // The trader's OWN results with strategies built from this template.
  const mine = useMemo(() => {
    const ids = new Set(strategies.filter((s) => s.libraryId === t.id).map((s) => s.id));
    const rows = strategyPerformance(trades.filter((x) => x.strategyId && ids.has(x.strategyId)), strategies);
    return rows.reduce(
      (acc, r) => ({ trades: acc.trades + r.trades, wins: acc.wins + r.wins, losses: acc.losses + r.losses, netR: acc.netR + r.netR }),
      { trades: 0, wins: 0, losses: 0, netR: 0 },
    );
  }, [strategies, trades, t.id]);

  return (
    <Screen
      header={
        <AppHeader
          title={CATEGORY_LABEL[t.category]}
          back
          right={<HeaderIconButton icon="git-compare-outline" label="Compare" onPress={() => router.push({ pathname: '/strategy/compare', params: { ids: t.id } })} />}
        />
      }
      footer={
        <>
          <Button label="Use in Analyze" icon="shield-checkmark" onPress={() => openTemplateInAnalyze(t)} />
          <View style={styles.btnRow}>
            <Button
              label={saved ? 'Saved' : 'Save Strategy'}
              icon={saved ? 'bookmark' : 'bookmark-outline'}
              variant="secondary"
              size="md"
              style={styles.flex}
              disabled={!!saved}
              onPress={() => saveTemplate(t)}
            />
            <Button label="Customize" icon="create-outline" variant="secondary" size="md" style={styles.flex} onPress={() => customizeTemplate(t)} />
            <Button label="Practice" icon="school-outline" variant="secondary" size="md" style={styles.flex} onPress={() => practiceTemplate(t)} />
          </View>
        </>
      }>
      <View style={{ gap: spacing.sm }}>
        <AppText variant="title">{t.name}</AppText>
        <View style={styles.badges}>
          <StatusBadge label={FRAMEWORK_LABEL[t.framework]} tone="accent" icon="library-outline" size="sm" />
          <StatusBadge label={t.experienceLevel} tone={COMPLEXITY_TONE[t.experienceLevel]} size="sm" />
          {t.isBacktested ? <StatusBadge label="Backtested" tone="positive" size="sm" /> : null}
        </View>
        <AppText variant="label" style={{ marginTop: spacing.sm }}>
          What this strategy looks for
        </AppText>
        <AppText variant="body" tone="secondary">
          {t.description}
        </AppText>
      </View>

      <Card>
        <View style={styles.row}>
          <Ionicons name="bulb-outline" size={16} color={colors.accentBright} />
          <AppText variant="label" tone="accent">
            In plain English
          </AppText>
        </View>
        <AppText variant="body" style={{ marginTop: spacing.sm }}>
          {t.education}
        </AppText>
      </Card>

      <Card>
        <View style={styles.grid}>
          <Metric label="Sessions" value={t.sessions.map((s) => SESSION_LABEL[s]).join(', ')} compact />
          <Metric label="Window" value={windowLabel(t)} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Timeframes" value={t.timeframeLabel} compact />
          <Metric label="Typical R:R" value={`1:${t.defaultRiskReward}`} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Setup frequency" value={FREQUENCY_LABEL[t.frequency]} compact />
          <Metric label="Hold time" value={t.holdTimes.map((h) => HOLD_LABEL[h]).join(', ')} compact />
        </View>
      </Card>

      <Section title="Setup" body={t.setup} />

      {t.visual ? (
        <>
          <SectionHeader title="Visual example" />
          <StrategyVisualExample visual={t.visual} strategyName={t.shortName} />
        </>
      ) : null}

      <SectionHeader title="Entry checklist" />
      <Card>
        <RuleChecklist rows={t.checklist.map((c) => ({ id: c, label: c, state: 'pending' as const }))} />
      </Card>

      <SectionHeader title="Rules" />
      <Card>
        {t.rules.map((r, i) => (
          <AppText key={r} variant="body" style={{ marginTop: i ? spacing.sm : 0 }}>
            {i + 1}. {r}
          </AppText>
        ))}
      </Card>

      <Section title="Entry trigger" body={t.entryTrigger} extra={t.confirmations.map((c) => `Confirmation: ${c}`)} />
      <Section title="Stop loss" body={t.stopLoss} />
      <Section title="Profit target" body={`${t.profitTarget} Default 1:${t.defaultRiskReward} — adjust it to your own plan.`} />
      <Section title="Invalidation" bullets={t.invalidationRules} tone="danger" />
      <Section title="Avoid when" bullets={t.avoidConditions} tone="warning" />

      <SectionHeader title="Best market condition" />
      <View style={styles.badges}>
        {t.marketConditions.map((c) => (
          <StatusBadge key={c} label={CONDITION_LABEL[c]} size="sm" />
        ))}
      </View>

      <SectionHeader title="Common instruments" />
      <View style={styles.badges}>
        {t.instruments.map((i) => (
          <StatusBadge key={i} label={i} tone="neutral" size="sm" />
        ))}
      </View>

      <SectionHeader title="Your results" />
      <Card>
        {mine.trades > 0 ? (
          <View style={styles.grid}>
            <Metric label="Trades" value={String(mine.trades)} compact />
            <Metric label="Win rate" value={mine.wins + mine.losses ? `${Math.round((mine.wins / (mine.wins + mine.losses)) * 100)}%` : '—'} compact />
            <Metric label="Net" value={rMultiple(Math.round(mine.netR * 100) / 100)} tone={mine.netR > 0 ? 'positive' : mine.netR < 0 ? 'danger' : undefined} compact />
          </View>
        ) : (
          <AppText variant="caption">No journaled trades with this strategy yet. Prop Guard tracks YOUR results here as you trade it — no sample or template statistics are shown.</AppText>
        )}
      </Card>

      <AppText variant="caption" tone="tertiary">
        {t.isBacktested ? '' : 'Framework only — Prop Guard has no backtest data for this template. '}
        {LIBRARY_DISCLAIMER}
      </AppText>
    </Screen>
  );
}

function Section({ title, body, bullets, extra, tone }: { title: string; body?: string; bullets?: string[]; extra?: string[]; tone?: 'danger' | 'warning' }) {
  return (
    <>
      <SectionHeader title={title} />
      <Card tone={tone}>
        {body ? <AppText variant="body">{body}</AppText> : null}
        {(bullets ?? []).map((b, i) => (
          <AppText key={b} variant="body" style={{ marginTop: i || body ? spacing.xs : 0 }}>
            • {b}
          </AppText>
        ))}
        {(extra ?? []).map((b) => (
          <AppText key={b} variant="caption" style={{ marginTop: spacing.xs }}>
            {b}
          </AppText>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grid: { flexDirection: 'row', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
