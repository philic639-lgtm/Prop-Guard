import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/charts/BarChart';
import { ChartCard } from '@/components/charts/ChartCard';
import { LineChart } from '@/components/charts/LineChart';
import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, AppText, Card, EmptyState, Metric, Screen, SectionHeader, SegmentedControl } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useAccountTrades, useActiveAccount, useDiscipline } from '@/hooks/useAppData';
import {
  averageExcursions,
  bestStrategy,
  computeStats,
  equityCurve,
  filterByRange,
  mostTradedInstrument,
  performanceByCompliance,
  pnlByHour,
  pnlByInstrument,
  pnlByStrategy,
  pnlByWeekday,
  violationCounts,
} from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { factor, money, pct, rMultiple } from '@/utils/format';

type Range = 'week' | 'month' | 'all';

const VIOLATION_LABEL: Record<string, string> = {
  RULE_OVERRIDDEN: 'Rule overrides',
  STOP_WIDENED: 'Stops widened',
  COOLDOWN_BROKEN: 'Cooldowns broken',
  STRATEGY_VIOLATION: 'Strategy violations',
};

export default function AnalyticsScreen() {
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
    return {
      trades,
      stats,
      curve: equityCurve(trades, start).map((p) => p.y),
      start,
      best: bestStrategy(trades, strategies),
      market: mostTradedInstrument(trades),
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
  const rangeLabel = range === 'week' ? 'This week' : range === 'month' ? 'This month' : 'All time';

  return (
    <Screen header={<AppHeader title="Performance" subtitle={account?.name} back />}>
      <SegmentedControl
        options={[
          { value: 'week', label: '7D' },
          { value: 'month', label: '30D' },
          { value: 'all', label: 'All' },
        ]}
        value={range}
        onChange={setRange}
      />
      {s.count === 0 ? (
        <Card>
          <EmptyState icon="stats-chart-outline" title="No closed trades" message="Analytics appear after your first closed trade in this period." />
        </Card>
      ) : (
        <>
          <ChartCard title={rangeLabel} value={money(s.netPnl, { sign: true })} valueTone={s.netPnl >= 0 ? 'positive' : 'danger'} subtitle={`${s.count} trades · equity curve`}>
            <LineChart data={data.curve} baseline={data.start} color={s.netPnl >= 0 ? colors.positive : colors.danger} accessibilityLabel={`Equity curve, net ${money(s.netPnl)}`} />
          </ChartCard>

          <Card>
            <View style={styles.grid}>
              <Metric label="Win rate" value={pct(s.winRate)} />
              <Metric label="Avg R" value={rMultiple(s.avgR)} />
            </View>
            <View style={[styles.grid, styles.gap]}>
              <Metric label="Profit factor" value={factor(s.profitFactor)} />
              <Metric label="Discipline" value={String(score.score)} tone={score.tone} />
            </View>
            <View style={[styles.grid, styles.gap]}>
              <Metric label="Avg win" value={money(s.avgWin)} tone="positive" />
              <Metric label="Avg loss" value={money(s.avgLoss)} tone="danger" />
            </View>
            <View style={[styles.grid, styles.gap]}>
              <Metric label="Best strategy" value={data.best?.label ?? '—'} compact />
              <Metric label="Most traded" value={data.market ?? '—'} compact />
            </View>
          </Card>

          <ProGate feature="advancedAnalytics" title="Advanced analytics" description="Break down performance by strategy, hour, day, instrument and rule compliance.">
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

            <ChartCard title="P/L by strategy">
              <BarChart data={data.byStrategy.map((g) => ({ key: g.key, label: g.label, value: g.pnl }))} />
              <View style={styles.winRates}>
                {data.byStrategy.map((g) => (
                  <AppText key={g.key} variant="caption">
                    {g.label}: {pct(g.winRate)} win rate · {g.count} trades
                  </AppText>
                ))}
              </View>
            </ChartCard>
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
  grid: { flexDirection: 'row', gap: spacing.md },
  gap: { marginTop: spacing.lg },
  gapSm: { marginTop: spacing.sm },
  flex: { flex: 1 },
  winRates: { marginTop: spacing.md, gap: 2 },
  vRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
