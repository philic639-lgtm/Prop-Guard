import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TradeCard } from '@/components/domain/TradeCard';
import { AppHeader, AppText, Button, Card, EmptyState, Metric, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useActiveAccount } from '@/hooks/useAppData';
import { summarizeSession } from '@/lib/engines';
import { aiService } from '@/services/ai';
import { notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement } from '@/store/useSubscriptionStore';
import type { SessionReview } from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { longDate, money, pct, rMultiple } from '@/utils/format';

export default function SessionReviewScreen() {
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
  const [loading, setLoading] = useState(false);

  const today = dayKey(new Date());
  const session = useMemo(
    () =>
      params.sessionId
        ? sessions.find((s) => s.id === params.sessionId)
        : sessions.find((s) => s.accountId === account?.id && s.date === today),
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
  const summary = useMemo(() => summarizeSession(trades.filter((t) => t.status === 'closed'), events, rules), [trades, events, rules]);
  const names = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const review = session?.review ?? null;
  const ended = session?.status === 'ended';
  const openCount = trades.filter((t) => t.status === 'open').length;

  const generate = async (): Promise<SessionReview | null> => {
    setLoading(true);
    try {
      const r = await aiService.generateSessionReview({
        trades: trades.map((t) => ({
          direction: t.direction,
          instrument: t.instrument,
          pnl: t.pnl,
          realizedR: t.realizedR,
          grade: t.setupGrade,
          violations: t.rulesViolated,
        })),
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
    if (!session || review || trades.length === 0 || !aiAllowed) return;
    const t = setTimeout(() => void generate(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, aiAllowed]);

  const onEnd = async () => {
    if (!session) return router.replace('/home');
    const r = review ?? (await generate());
    endSession(session.id, r);
    const unjournaled = trades.some((t) => t.status === 'closed' && !t.journaled);
    if (unjournaled) void notificationService.scheduleIn('journal', 30 * 60, prefs, 'journal');
  };

  if (!account) {
    return (
      <Screen header={<AppHeader title="Session review" back />}>
        <EmptyState title="No account" message="Add an account to start tracking sessions." />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title={ended ? 'Session complete' : 'Session review'} subtitle={session ? longDate(session.startedAt) : 'Today'} back />}
      footer={
        ended ? (
          <Button label="Done" onPress={() => router.replace('/home')} />
        ) : (
          <Button label="End session" icon="flag" disabled={openCount > 0} onPress={onEnd} loading={loading} />
        )
      }>
      {openCount > 0 ? (
        <Card tone="warning">
          <AppText variant="body">Close your open trade before ending the session.</AppText>
        </Card>
      ) : null}

      <Card raised>
        <AppText variant="label">Net P/L</AppText>
        <AppText variant="hero" tone={summary.netPnl > 0 ? 'positive' : summary.netPnl < 0 ? 'danger' : 'primary'}>
          {money(summary.netPnl, { sign: true })}
        </AppText>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Trades" value={String(summary.trades)} compact />
          <Metric label="Wins" value={String(summary.wins)} compact />
          <Metric label="Losses" value={String(summary.losses)} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Win rate" value={pct(summary.winRate)} compact />
          <Metric label="Average R" value={rMultiple(summary.avgR)} compact />
          <Metric label="Rules followed" value={`${summary.rulesFollowedPct}%`} compact tone={summary.rulesFollowedPct >= 90 ? 'positive' : 'warning'} />
        </View>
      </Card>

      {trades.length === 0 ? (
        <Card>
          <EmptyState icon="leaf-outline" title="No trades today" message="Sitting out when nothing meets your criteria is a disciplined outcome." />
        </Card>
      ) : (
        <Card>
          <View style={styles.head}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <AppText variant="label" tone="accent">
              {review?.source === 'ai' ? 'AI review' : 'Session review'}
            </AppText>
          </View>
          {review ? (
            <View style={styles.review}>
              <AppText variant="body">{review.summary}</AppText>
              {review.strengths.map((s) => (
                <View key={s} style={styles.line}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.positive} />
                  <AppText variant="body" style={styles.flex}>
                    {s}
                  </AppText>
                </View>
              ))}
              {review.improvements.map((s) => (
                <View key={s} style={styles.line}>
                  <Ionicons name="alert-circle" size={16} color={colors.warning} />
                  <AppText variant="body" style={styles.flex}>
                    {s}
                  </AppText>
                </View>
              ))}
              <View style={styles.focus}>
                <AppText variant="label" style={{ fontSize: 10 }}>
                  Main improvement tomorrow
                </AppText>
                <AppText variant="heading">{review.focusTomorrow}</AppText>
              </View>
            </View>
          ) : (
            <Button label={loading ? 'Reviewing…' : 'Generate review'} variant="secondary" size="md" loading={loading} onPress={() => void generate()} style={{ marginTop: spacing.md }} />
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
      {ended ? <StatusBadge label="Session ended" tone="neutral" icon="flag" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  review: { marginTop: spacing.md, gap: spacing.md },
  line: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  focus: { gap: 4, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
