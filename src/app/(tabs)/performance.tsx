import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/charts/BarChart';
import { ChartCard } from '@/components/charts/ChartCard';
import { LineChart } from '@/components/charts/LineChart';
import { ProGate } from '@/components/domain/ProGate';
import {
  AppHeader,
  AppText,
  Card,
  EmptyState,
  HeaderIconButton,
  ListRow,
  Divider,
  Metric,
  MetricTile,
  Screen,
  SectionHeader,
  TabSwitch,
  TileGrid,
} from '@/components/ui';
import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';
import { useAccountTrades, useActiveAccount, useDiscipline } from '@/hooks/useAppData';
import {
  averageExcursions,
  computeStats,
  equityCurve,
  filterByRange,
  performanceByCompliance,
  performanceByConditions,
  pnlByHour,
  pnlByInstrument,
  pnlByStrategy,
  pnlByWeekday,
  violationCounts,
  type ConditionBucket,
} from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { money, pct, rMultiple } from '@/utils/format';

type Range = 'week' | 'month' | 'quarter' | 'all';

const VIOLATION_LABEL: Record<string, string> = {
  RULE_OVERRIDDEN: 'Rule overrides',
  STOP_WIDENED: 'Stops widened',
  COOLDOWN_BROKEN: 'Cooldowns broken',
  STRATEGY_VIOLATION: 'Strategy violations',
};

const BUCKET_TONE: Record<ConditionBucket['key'], Tone> = { all: 'positive', one: 'warning', two_plus: 'danger' };

/** Plain-language read of whether following the strategy correlates with results. */
function conditionInsight(buckets: ConditionBucket[]): string {
  const all = buckets[0];
  const rest = buckets.slice(1).filter((b) => b.count > 0);
  if (all.count === 0) return 'No full-match trades yet. Take only setups that meet every condition and compare.';
  if (rest.length === 0) return `Every trade in this period met all conditions. Your results: ${rMultiple(all.totalR)} across ${all.count} trades.`;
  const restTrades = rest.reduce((s, b) => s + b.count, 0);
  const restR = rest.reduce((s, b) => s + b.totalR, 0);
  const restAvg = restR / restTrades;
  if ((all.avgR ?? 0) > restAvg) {
    return `Your results are stronger when every condition is confirmed: ${rMultiple(all.avgR)} per trade vs ${rMultiple(restAvg)} when conditions were missed. Missed-condition trades cost ${rMultiple(restR)} total.`;
  }
  return `Missed-condition trades have not hurt results yet (${rMultiple(restAvg)} avg), but the sample is small. Keep logging conditions to see the real relationship.`;
}

export default function PerformanceScreen() {
  const account = useActiveAccount();
  const allTrades = useAccountTrades();
  const strategies = useAppStore((s) => s.strategies);
  const events = useAppStore((s) => s.events);
  const { score } = useDiscipline(30);
  const [range, setRange] = useState<Range>('month');

  const data = useMemo(() => {
    const trades = filterByRange(allTrades, range);
    const ids = new Set(trades.map((t) => t.id));
    const ev = events.filter((e) => e.tradeId && ids.has(e.tradeId));
    const stats = computeStats(trades);
    const closedBefore = allTrades.filter((t) => t.status === 'closed' && !ids.has(t.id) && t.pnl != null);
    const start = (account?.startingBalance ?? 0) + closedBefore.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalR = trades.reduce((s, t) => s + (t.status === 'closed' ? (t.realizedR ?? 0) : 0), 0);
    return {
      stats,
      totalR,
      curve: equityCurve(trades, start).map((p) => p.y),
      start,
      buckets: performanceByConditions(trades),
      byStrategy: pnlByStrategy(trades, strategies),
      byDay: pnlByWeekday(trades),
      byHour: pnlByHour(trades),
      byInstrument: pnlByInstrument(trades),
      compliance: performanceByCompliance(trades, ev),
      violations: violationCounts(ev),
      excursions: averageExcursions(trades),
    };
  }, [allTrades, range, events, strategies, account?.startingBalance]);

  const s = data.stats;

  return (
    <Screen tabBar header={<AppHeader title="Performance" subtitle={account?.name} right={<HeaderIconButton icon="ribbon-outline" label="Discipline score" onPress={() => router.push('/discipline')} />} />}>
      <TabSwitch
        options={[
          { value: 'week', label: '7D' },
          { value: 'month', label: '30D' },
          { value: 'quarter', label: '90D' },
          { value: 'all', label: 'All' },
        ]}
        value={range}
        onChange={setRange}
      />

      {s.count === 0 ? (
        <Card>
          <EmptyState icon="stats-chart-outline" title="No closed trades" message="Performance appears after your first closed trade in this period." actionLabel="Journal a trade" onAction={() => router.push('/journal/new')} />
        </Card>
      ) : (
        <>
          <AppText variant="label">Strategy performance</AppText>
          <TileGrid>
            <MetricTile label="Net P&L" value={rMultiple(data.totalR).replace('.00', '')} tone={data.totalR >= 0 ? 'positive' : 'danger'} sub={money(s.netPnl, { sign: true })} align="center" />
            <MetricTile label="Win rate" value={pct(s.winRate)} tone="positive" sub={`${s.wins}W · ${s.losses}L`} align="center" />
            <MetricTile label="Total trades" value={String(s.count)} align="center" />
            <MetricTile label="Average R" value={rMultiple(s.avgR)} align="center" sub={`PF ${s.profitFactor == null ? '—' : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}`} />
          </TileGrid>

          <ChartCard title="Equity curve" value={money(s.netPnl, { sign: true })} valueTone={s.netPnl >= 0 ? 'positive' : 'danger'} subtitle={`${s.count} closed trades`}>
            <LineChart data={data.curve} baseline={data.start} color={s.netPnl >= 0 ? colors.positive : colors.danger} accessibilityLabel={`Equity curve, net ${money(s.netPnl)}`} />
          </ChartCard>

          <SectionHeader title="Strategy match results" />
          <Card>
            {data.buckets.map((b, i) => {
              const tone = toneColor[BUCKET_TONE[b.key]];
              return (
                <View key={b.key} style={[styles.bucket, i > 0 && styles.border]} accessible accessibilityLabel={`${b.label} conditions: ${b.count} trades, ${pct(b.winRate)} win rate, ${rMultiple(b.totalR)}`}>
                  <View style={[styles.bucketBadge, { backgroundColor: tone.bg, borderColor: tone.fg + '88' }]}>
                    <AppText variant="bodyStrong" style={{ color: tone.fg, fontSize: 13 }}>
                      {b.label.replace(' or less', '')}
                    </AppText>
                  </View>
                  <AppText variant="body" tone="secondary" style={styles.flex}>
                    {b.count} trade{b.count === 1 ? '' : 's'} · {pct(b.winRate)} win
                    {b.key === 'two_plus' ? ' · or less' : ''}
                  </AppText>
                  <AppText variant="bodyStrong" tone={b.totalR > 0 ? 'positive' : b.totalR < 0 ? 'danger' : 'secondary'}>
                    {rMultiple(b.totalR)}
                  </AppText>
                </View>
              );
            })}
          </Card>
          <Card tone="warning">
            <View style={styles.row}>
              <Ionicons name="bulb" size={18} color={colors.warning} />
              <AppText variant="label" tone="warning">
                Prop Guard insight
              </AppText>
            </View>
            <AppText variant="body" style={{ marginTop: spacing.sm }}>
              {conditionInsight(data.buckets)}
            </AppText>
          </Card>

          <SectionHeader title="By strategy" />
          <Card>
            {data.byStrategy.map((g, i) => (
              <View key={g.key} style={[styles.bucket, i > 0 && styles.border]}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{g.label}</AppText>
                  <AppText variant="caption">
                    {g.count} trades · {pct(g.winRate)} win
                  </AppText>
                </View>
                <AppText variant="bodyStrong" tone={g.pnl >= 0 ? 'positive' : 'danger'}>
                  {money(g.pnl, { sign: true })}
                </AppText>
              </View>
            ))}
          </Card>

          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            <ListRow icon="sparkles-outline" iconTone="accent" title="AI session summary" subtitle="What went well, what to improve" onPress={() => router.push('/session/review')} />
            <Divider />
            <ListRow icon="ribbon-outline" iconTone="positive" title="Discipline score" value={String(score.score)} onPress={() => router.push('/discipline')} />
          </Card>

          <ProGate feature="advancedAnalytics" title="Advanced analytics" description="Break down performance by hour, day, instrument and rule compliance.">
            <SectionHeader title="Rules vs. results" />
            <Card>
              <View style={styles.grid}>
                <View style={styles.flex}>
                  <AppText variant="label" tone="positive">
                    Rules followed
                  </AppText>
                  <AppText variant="number" tone={data.compliance.followed.netPnl >= 0 ? 'positive' : 'danger'} style={styles.gapSm}>
                    {money(data.compliance.followed.netPnl, { sign: true })}
                  </AppText>
                  <AppText variant="caption">
                    {data.compliance.followed.count} trades · {pct(data.compliance.followed.winRate)} win
                  </AppText>
                </View>
                <View style={styles.flex}>
                  <AppText variant="label" tone="danger">
                    After violations
                  </AppText>
                  <AppText variant="number" tone={data.compliance.violated.netPnl >= 0 ? 'positive' : 'danger'} style={styles.gapSm}>
                    {money(data.compliance.violated.netPnl, { sign: true })}
                  </AppText>
                  <AppText variant="caption">
                    {data.compliance.violated.count} trades · {pct(data.compliance.violated.winRate)} win
                  </AppText>
                </View>
              </View>
            </Card>
            <ChartCard title="P/L by day">
              <BarChart data={data.byDay.map((g) => ({ key: g.key, label: g.label, value: g.pnl }))} />
            </ChartCard>
            <ChartCard title="P/L by hour">
              <BarChart data={data.byHour.map((g) => ({ key: g.key, label: g.label, value: g.pnl }))} />
            </ChartCard>
            <ChartCard title="P/L by instrument">
              <BarChart data={data.byInstrument.map((g) => ({ key: g.key, label: `${g.label} (${g.count})`, value: g.pnl }))} />
            </ChartCard>
            <Card>
              <AppText variant="label">Excursions</AppText>
              <View style={[styles.grid, styles.gapSm]}>
                <Metric label="Avg adverse (MAE)" value={data.excursions.mae != null ? `${data.excursions.mae} pts` : '—'} compact />
                <Metric label="Avg favorable (MFE)" value={data.excursions.mfe != null ? `${data.excursions.mfe} pts` : '—'} compact />
              </View>
            </Card>
            <Card>
              <AppText variant="label">Rule violations</AppText>
              {data.violations.length === 0 ? (
                <AppText variant="body" tone="positive" style={styles.gapSm}>
                  No violations in this period.
                </AppText>
              ) : (
                data.violations.map((v) => (
                  <View key={v.type} style={[styles.vRow, styles.gapSm]}>
                    <AppText variant="body">{VIOLATION_LABEL[v.type] ?? v.type}</AppText>
                    <AppText variant="bodyStrong" tone="warning">
                      {v.count}
                    </AppText>
                  </View>
                ))
              )}
            </Card>
          </ProGate>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grid: { flexDirection: 'row', gap: spacing.md },
  gapSm: { marginTop: spacing.sm },
  flex: { flex: 1 },
  bucket: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bucketBadge: { minWidth: 48, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center' },
  vRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
