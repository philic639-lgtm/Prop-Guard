import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChartCard } from '@/components/charts/ChartCard';
import { LineChart } from '@/components/charts/LineChart';
import { ProGate } from '@/components/domain/ProGate';
import { AppHeader, AppText, Card, CircularScore, RiskProgress, Screen, SectionHeader } from '@/components/ui';
import { colors, spacing, toneColor } from '@/constants/theme';
import { useDiscipline } from '@/hooks/useAppData';
import { disciplineLabel, disciplineTimeline } from '@/lib/engines';
import { shortDate, time } from '@/utils/format';

const EVENT_LABEL: Record<string, string> = {
  RULE_OVERRIDDEN: 'Rule overridden',
  STOP_WIDENED: 'Stop widened',
  COOLDOWN_BROKEN: 'Cooldown broken',
  STRATEGY_VIOLATION: 'Strategy violation',
  DAILY_LIMIT_HIT: 'Daily limit hit',
  TRADE_LIMIT_HIT: 'Trade limit hit',
};

export default function DisciplineScreen() {
  const { score, trades, events } = useDiscipline(30);
  const timeline = useMemo(() => disciplineTimeline(trades, events), [trades, events]);
  const recentEvents = useMemo(
    () => events.filter((e) => e.type !== 'JOURNAL_COMPLETED' && e.type !== 'RULE_FOLLOWED').sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 12),
    [events],
  );

  return (
    <Screen header={<AppHeader title="Discipline" subtitle="Last 30 days" back />}>
      <ProGate feature="disciplineScore" title="Discipline Score" description="See exactly which rules you follow — and which ones cost you.">
        <View style={styles.hero}>
          <CircularScore value={score.score} tone={score.tone} size={170} stroke={12} label="Discipline" />
          <AppText variant="heading" style={{ color: toneColor[score.tone].fg }}>
            {score.label.toUpperCase()}
          </AppText>
          <AppText variant="caption" align="center">
            Measures adherence to your own rules — not profit.
          </AppText>
        </View>

        <Card>
          {score.components.map((c, i) => {
            const tone = disciplineLabel(c.score).tone;
            return (
              <View key={c.key} style={[styles.comp, i > 0 && styles.border]}>
                <View style={styles.compHead}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {c.label}
                  </AppText>
                  <AppText variant="number" style={{ fontSize: 17, color: toneColor[tone].fg }}>
                    {c.score}
                  </AppText>
                </View>
                <RiskProgress value={c.score / 100} tone={tone} height={5} label={c.label} />
              </View>
            );
          })}
        </Card>

        {timeline.length > 1 ? (
          <ChartCard title="Timeline" subtitle={`${timeline.length} trading days`}>
            <LineChart data={timeline.map((p) => p.score)} color={colors.accent} height={130} accessibilityLabel="Daily discipline score timeline" />
            <View style={styles.axis}>
              <AppText variant="caption">{shortDate(timeline[0].date + 'T12:00:00')}</AppText>
              <AppText variant="caption">{shortDate(timeline[timeline.length - 1].date + 'T12:00:00')}</AppText>
            </View>
          </ChartCard>
        ) : null}

        <SectionHeader title="Recent events" />
        <Card>
          {recentEvents.length === 0 ? (
            <AppText variant="body" tone="positive">
              No rule breaks recorded. Keep it that way.
            </AppText>
          ) : (
            recentEvents.map((e, i) => (
              <View key={e.id} style={[styles.event, i > 0 && styles.border]}>
                <AppText variant="bodyStrong" tone="warning">
                  {EVENT_LABEL[e.type] ?? e.type}
                </AppText>
                <AppText variant="caption">{e.detail}</AppText>
                <AppText variant="caption" tone="tertiary">
                  {shortDate(e.at)} · {time(e.at)}
                </AppText>
              </View>
            ))
          )}
        </Card>
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  comp: { gap: 8, paddingVertical: spacing.md },
  compHead: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  event: { gap: 2, paddingVertical: spacing.md },
});
