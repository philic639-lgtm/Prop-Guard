import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TradeCard } from '@/components/domain/TradeCard';
import { AppHeader, AppText, Button, Card, EmptyState, MetricTile, Screen, SectionHeader, StatusBadge, TabSwitch, TileGrid } from '@/components/ui';
import { colors, spacing, toneColor } from '@/constants/theme';
import { useActiveAccount, useDiscipline } from '@/hooks/useAppData';
import { useNow } from '@/hooks/useNow';
import { localSessionReview, performanceByConditions, sessionFlags, summarizeSession } from '@/lib/engines';
import { aiService } from '@/services/ai';
import { notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement } from '@/store/useSubscriptionStore';
import type { SessionReview } from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { longDate, money, pct, rMultiple } from '@/utils/format';

type Tab = 'today' | 'weekly' | 'insights';

function Line({ ok, text }: { ok: boolean | 'warn'; text: string }) {
  const icon = ok === true ? 'checkmark-circle' : ok === 'warn' ? 'alert-circle' : 'close-circle';
  const color = ok === true ? colors.positive : ok === 'warn' ? colors.warning : colors.danger;
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={17} color={color} />
      <AppText variant="body" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

export default function SessionSummaryScreen() {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const account = useActiveAccount();
  const sessions = useAppStore((s) => s.sessions);
  const allTrades = useAppStore((s) => s.trades);
  const allEvents = useAppStore((s) => s.events);
  const strategies = useAppStore((s) => s.strategies);
  const rules = useAppStore((s) => s.tradingRules);
  const prefs = useAppStore((s) => s.preferences.notifications);
  const endSession = useAppStore((s) => s.endSession);
  const setSessionReview = useAppStore((s) => s.setSessionReview);
  const aiAllowed = useEntitlement('aiCoach');
  const { score } = useDiscipline(30);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const now = useNow(60_000);

  const today = dayKey(new Date());
  const session = useMemo(
    () => (params.sessionId ? sessions.find((s) => s.id === params.sessionId) : sessions.find((s) => s.accountId === account?.id && s.date === today)),
    [params.sessionId, sessions, account?.id, today],
  );
  const trades = useMemo(
    () =>
      allTrades
        .filter((t) => (session ? t.sessionId === session.id : t.accountId === account?.id && dayKey(t.openedAt) === today) && t.status !== 'cancelled')
        .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt)),
    [allTrades, session, account?.id, today],
  );
  const events = useMemo(() => {
    const ids = new Set(trades.map((t) => t.id));
    return allEvents.filter((e) => (e.tradeId && ids.has(e.tradeId)) || (session && e.sessionId === session.id));
  }, [allEvents, trades, session]);
  const closed = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);
  const summary = useMemo(() => summarizeSession(closed, events, rules), [closed, events, rules]);
  const flags = useMemo(() => sessionFlags(summary, trades, rules), [summary, trades, rules]);

  // Weekly roll-up (last 7 days, active account).
  const weekly = useMemo(() => {
    const cutoff = now.getTime() - 7 * 86_400_000;
    const wt = allTrades.filter((t) => t.accountId === account?.id && t.status === 'closed' && Date.parse(t.openedAt) >= cutoff);
    const ids = new Set(wt.map((t) => t.id));
    const we = allEvents.filter((e) => e.tradeId && ids.has(e.tradeId));
    const s = summarizeSession(wt, we, { ...rules, maxTradesPerDay: rules.maxTradesPerDay * 7 });
    const days = new Set(wt.map((t) => dayKey(t.openedAt))).size;
    return { trades: wt, summary: s, flags: sessionFlags(s, wt, { ...rules, maxTradesPerDay: rules.maxTradesPerDay * Math.max(1, days) }), days, review: localSessionReview(s, rules), buckets: performanceByConditions(wt) };
  }, [allTrades, allEvents, account?.id, rules, now]);

  const names = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const review = session?.review ?? null;
  const ended = session?.status === 'ended';
  const openCount = trades.filter((t) => t.status === 'open').length;

  const generate = async (): Promise<SessionReview | null> => {
    setLoading(true);
    try {
      const r = await aiService.generateSessionReview({
        trades: closed.map((t) => ({ direction: t.direction, instrument: t.instrument, pnl: t.pnl, realizedR: t.realizedR, grade: t.setupGrade, violations: t.rulesViolated })),
        netPnl: summary.netPnl,
        winRate: summary.winRate,
        rulesFollowedPct: summary.rulesFollowedPct,
        violations: summary.violations.map((v) => ({ type: v.type, detail: v.detail })),
        cooldownGaps: summary.cooldownGaps,
        rules: { maxTradesPerDay: rules.maxTradesPerDay, cooldownMinutes: rules.cooldownMinutes, maxRiskPerTrade: rules.maxRiskPerTrade },
      });
      const full: SessionReview = { ...r, generatedAt: new Date().toISOString(), source: r.source ?? 'local' };
      if (session) setSessionReview(session.id, full);
      return full;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session || review || closed.length === 0 || !aiAllowed) return;
    const t = setTimeout(() => void generate(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, aiAllowed]);

  const onEnd = async () => {
    if (!session) return router.replace('/home');
    const r = review ?? (await generate());
    endSession(session.id, r);
    if (trades.some((t) => t.status === 'closed' && !t.journaled)) void notificationService.scheduleIn('journal', 30 * 60, prefs, 'journal');
  };

  if (!account) {
    return (
      <Screen header={<AppHeader title="AI session summary" back />}>
        <EmptyState title="No account" message="Add an account to start tracking sessions." />
      </Screen>
    );
  }

  const weakest = [...score.components].sort((a, b) => a.score - b.score)[0];

  return (
    <Screen
      header={<AppHeader title="AI session summary" subtitle={session ? longDate(session.startedAt) : 'Today'} back />}
      footer={
        tab !== 'today' ? undefined : ended ? (
          <Button label="View Full Journal" onPress={() => router.replace('/journal')} />
        ) : (
          <Button label="End Session" icon="flag" disabled={openCount > 0} onPress={onEnd} loading={loading} />
        )
      }>
      <TabSwitch
        options={[
          { value: 'today', label: 'Today' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'insights', label: 'Insights' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'today' ? (
        <>
          {openCount > 0 ? (
            <Card tone="warning">
              <AppText variant="body">Close your open trade before ending the session.</AppText>
            </Card>
          ) : null}
          <Card tone={summary.netPnl >= 0 ? 'positive' : 'danger'}>
            <View style={styles.row}>
              <Ionicons name="shield-checkmark" size={18} color={summary.netPnl >= 0 ? colors.positive : colors.danger} />
              <AppText variant="label">Session result</AppText>
              {ended ? <StatusBadge label="Ended" tone="neutral" size="sm" /> : null}
            </View>
            <AppText variant="hero" tone={summary.netPnl > 0 ? 'positive' : summary.netPnl < 0 ? 'danger' : 'primary'}>
              {money(summary.netPnl, { sign: true })}
            </AppText>
            <AppText variant="bodyStrong" tone="secondary">
              {summary.trades} / {rules.maxTradesPerDay} trades · {pct(summary.winRate)} win rate · {rMultiple(summary.avgR)} avg
            </AppText>
          </Card>

          <TileGrid>
            <MetricTile label="Rule adherence" value={`${flags.ruleAdherencePct}%`} tone={flags.ruleAdherencePct >= 90 ? 'positive' : 'warning'} align="center" />
            <MetricTile label="Risk discipline" value={`${flags.riskDiscipline}%`} tone={flags.riskDiscipline === 100 ? 'positive' : 'danger'} align="center" />
          </TileGrid>

          <Card>
            <AppText variant="label">Discipline flags</AppText>
            <View style={styles.lines}>
              <Line ok={!flags.revengeTrading} text={flags.revengeTrading ? 'Revenge trading detected — entered during a cooldown.' : 'No revenge trading detected.'} />
              <Line ok={!flags.overtrading} text={flags.overtrading ? `Overtrading — more than your ${rules.maxTradesPerDay}-trade limit.` : `Stayed within your ${rules.maxTradesPerDay}-trade limit.`} />
              <Line ok={flags.riskBreaches === 0} text={flags.riskBreaches === 0 ? 'Every trade was within your risk limits.' : `${flags.riskBreaches} trade${flags.riskBreaches > 1 ? 's' : ''} exceeded your risk limits.`} />
              <Line ok={flags.stopWidened === 0} text={flags.stopWidened === 0 ? 'No stops widened.' : `Stop widened ${flags.stopWidened} time${flags.stopWidened > 1 ? 's' : ''}.`} />
            </View>
          </Card>

          {closed.length === 0 ? (
            <Card>
              <EmptyState icon="leaf-outline" title="No closed trades today" message="Sitting out when nothing meets your criteria is a disciplined outcome." />
            </Card>
          ) : (
            <Card>
              <View style={styles.row}>
                <Ionicons name="sparkles" size={16} color={colors.accentBright} />
                <AppText variant="label" tone="accent">
                  {review?.source === 'ai' ? 'AI summary' : 'Summary'}
                </AppText>
              </View>
              {review ? (
                <View style={styles.lines}>
                  <AppText variant="body">{review.summary}</AppText>
                  {review.strengths.length > 0 ? <AppText variant="label" tone="positive">What went well</AppText> : null}
                  {review.strengths.map((s) => (
                    <Line key={s} ok text={s} />
                  ))}
                  {review.improvements.length > 0 ? <AppText variant="label" tone="warning">What to improve</AppText> : null}
                  {review.improvements.map((s) => (
                    <Line key={s} ok="warn" text={s} />
                  ))}
                  <View style={styles.focus}>
                    <AppText variant="label" style={{ fontSize: 10 }}>
                      Main improvement tomorrow
                    </AppText>
                    <AppText variant="heading">{review.focusTomorrow}</AppText>
                  </View>
                </View>
              ) : (
                <Button label={loading ? 'Reviewing…' : 'Generate summary'} variant="secondary" size="md" loading={loading} onPress={() => void generate()} style={{ marginTop: spacing.md }} />
              )}
            </Card>
          )}

          {trades.length > 0 ? <SectionHeader title="Trades" /> : null}
          {trades.map((t) => (
            <TradeCard
              key={t.id}
              trade={t}
              strategyName={t.strategyId ? names.get(t.strategyId) : null}
              onPress={() => router.push(t.status === 'open' ? { pathname: '/session/live', params: { id: t.id } } : { pathname: '/journal/[id]', params: { id: t.id } })}
            />
          ))}
        </>
      ) : null}

      {tab === 'weekly' ? (
        weekly.trades.length === 0 ? (
          <Card>
            <EmptyState icon="calendar-outline" title="No trades this week" message="Your weekly summary appears after your first closed trade." />
          </Card>
        ) : (
          <>
            <TileGrid>
              <MetricTile label="P&L" value={money(weekly.summary.netPnl, { sign: true })} tone={weekly.summary.netPnl >= 0 ? 'positive' : 'danger'} align="center" />
              <MetricTile label="Trades" value={String(weekly.summary.trades)} sub={`${weekly.days} trading days`} align="center" />
              <MetricTile label="Win rate" value={pct(weekly.summary.winRate)} align="center" />
              <MetricTile label="Rule adherence" value={`${weekly.flags.ruleAdherencePct}%`} tone={weekly.flags.ruleAdherencePct >= 90 ? 'positive' : 'warning'} align="center" />
            </TileGrid>
            <Card>
              <AppText variant="label">This week</AppText>
              <View style={styles.lines}>
                <AppText variant="body">{weekly.review.summary}</AppText>
                {weekly.review.strengths.map((s) => (
                  <Line key={s} ok text={s} />
                ))}
                {weekly.review.improvements.map((s) => (
                  <Line key={s} ok="warn" text={s} />
                ))}
                <Line ok={!weekly.flags.revengeTrading} text={weekly.flags.revengeTrading ? 'Revenge trading occurred this week.' : 'No revenge trading this week.'} />
                <Line ok={weekly.flags.riskDiscipline === 100} text={`Risk discipline ${weekly.flags.riskDiscipline}%`} />
              </View>
            </Card>
          </>
        )
      ) : null}

      {tab === 'insights' ? (
        <>
          <Card>
            <AppText variant="label">Results by conditions met (7 days)</AppText>
            {weekly.buckets.map((b) => (
              <View key={b.key} style={styles.bucket}>
                <AppText variant="bodyStrong" style={{ width: 92 }}>
                  {b.label}
                </AppText>
                <AppText variant="caption" style={styles.flex}>
                  {b.count} trades · {pct(b.winRate)} win
                </AppText>
                <AppText variant="bodyStrong" tone={b.totalR >= 0 ? 'positive' : 'danger'}>
                  {rMultiple(b.totalR)}
                </AppText>
              </View>
            ))}
          </Card>
          <Card tone="warning">
            <View style={styles.row}>
              <Ionicons name="bulb" size={18} color={colors.warning} />
              <AppText variant="label" tone="warning">
                Focus area
              </AppText>
            </View>
            <AppText variant="heading" style={{ marginTop: spacing.sm, color: toneColor.warning.fg }}>
              {weakest.label}: {weakest.score}
            </AppText>
            <AppText variant="body" style={{ marginTop: spacing.xs }}>
              This is your lowest discipline component over the last 30 days. Improving it moves your Discipline Score ({score.score}) the most.
            </AppText>
            <Button label="See discipline breakdown" variant="secondary" size="md" style={{ marginTop: spacing.md }} onPress={() => router.push('/discipline')} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  lines: { marginTop: spacing.md, gap: spacing.sm + 2 },
  line: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  focus: { gap: 4, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  bucket: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.sm },
});
