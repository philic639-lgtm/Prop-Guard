import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DemoBanner } from '@/components/domain/DemoBanner';
import { Disclaimer } from '@/components/domain/Disclaimer';
import { GUARD_UI } from '@/components/domain/guardUi';
import { ProGate } from '@/components/domain/ProGate';
import { TradeCard } from '@/components/domain/TradeCard';
import {
  AppText,
  Button,
  Card,
  CircularScore,
  EmptyState,
  HeaderIconButton,
  Logo,
  MetricTile,
  RiskProgress,
  Screen,
  SectionHeader,
  StatusBadge,
  TileGrid,
} from '@/components/ui';
import { colors, GUTTER, radius, spacing, toneColor } from '@/constants/theme';
import { CoachCard } from '@/features/home/CoachCard';
import { TradingPlanCard } from '@/features/home/TradingPlanCard';
import { useAccountTrades, useActiveAccount, useActiveStrategy, useDailyGuard, useDiscipline, useOpenTrade } from '@/hooks/useAppData';
import { evaluateAccount } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { dayKey, formatDuration } from '@/utils/dates';
import { money, pct } from '@/utils/format';

const CONNECTION_LABEL = { manual: 'Manual tracking', screenshot: 'Imported', connected: 'Connected' } as const;

export default function HomeScreen() {
  const account = useActiveAccount();
  const strategies = useAppStore((s) => s.strategies);
  const allTrades = useAppStore((s) => s.trades);
  const plans = useAppStore((s) => s.plans);
  const alerts = useAppStore((s) => s.alerts);
  const connection = useAppStore((s) => s.preferences.tradingProfile.connection);
  const guard = useDailyGuard(true);
  const strategy = useActiveStrategy();
  const trades = useAccountTrades();
  const openTrade = useOpenTrade();
  const { score } = useDiscipline(30);

  const recent = useMemo(() => trades.slice(0, 3), [trades]);
  const names = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const evaluation = useMemo(() => (account ? evaluateAccount(account, allTrades) : null), [account, allTrades]);
  const today = dayKey(new Date());
  const todaysPlan = plans.find((p) => p.status === 'saved' && p.accountId === account?.id && dayKey(p.createdAt) === today);
  const unread = alerts.some((a) => !a.read);
  const lastScore = trades.find((t) => t.setupScore != null)?.setupScore ?? null;

  const header = (
    <View style={styles.header}>
      <Logo />
      <View style={styles.headerRight}>
        <HeaderIconButton icon="notifications-outline" label="Alerts" badge={unread} onPress={() => router.push('/alerts')} />
        <HeaderIconButton icon="settings-outline" label="Profile and settings" onPress={() => router.push('/profile')} />
      </View>
    </View>
  );

  if (!account) {
    return (
      <Screen tabBar header={header}>
        <Card>
          <EmptyState icon="briefcase-outline" title="Add your trading account" message="Prop Guard needs your account limits before it can protect you." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
        </Card>
      </Screen>
    );
  }

  const progress = evaluation?.targetProgress ?? null;
  const profit = account.balance - account.cycleStartBalance;
  const consistency = evaluation?.rules.find((r) => r.id === 'consistency');
  const ui = guard ? GUARD_UI[guard.status] : null;

  return (
    <Screen tabBar header={header}>
      <DemoBanner />

      <Card onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })} accessibilityLabel={`${account.name}, ${CONNECTION_LABEL[connection]}`}>
        <View style={styles.accountRow}>
          <View style={styles.avatar}>
            <AppText variant="heading" style={{ color: colors.text }}>
              {(account.firm || account.name).charAt(0).toUpperCase()}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="heading" numberOfLines={1}>
              {account.name}
            </AppText>
            <View style={styles.connRow}>
              <View style={[styles.connDot, { backgroundColor: connection === 'connected' ? colors.positive : colors.accentBright }]} />
              <AppText variant="caption" style={{ color: connection === 'connected' ? colors.positive : colors.accentBright }}>
                {CONNECTION_LABEL[connection]}
              </AppText>
            </View>
          </View>
          <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
        </View>
        {progress != null && account.rules.profitTarget ? (
          <View style={styles.progress}>
            <View style={styles.progressHead}>
              <AppText variant="bodyStrong">Account progress</AppText>
              <AppText variant="bodyStrong" tone="positive">
                {pct(progress)}
              </AppText>
            </View>
            <RiskProgress value={progress} tone="positive" label="Profit target progress" />
            <AppText variant="caption">
              <AppText variant="bodyStrong" tone={profit >= 0 ? 'primary' : 'danger'} style={{ fontSize: 14 }}>
                {money(profit)}
              </AppText>{' '}
              / {money(account.rules.profitTarget)} profit target
            </AppText>
          </View>
        ) : null}
      </Card>

      {guard && ui ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Daily Guard: ${guard.headline}`}
          onPress={() => router.push('/analyze')}
          style={[styles.guard, { backgroundColor: toneColor[ui.tone].bg, borderColor: toneColor[ui.tone].fg + '66' }]}>
          <StatusBadge label={guard.status === 'CAUTION' ? guard.headline : ui.label} tone={ui.tone} icon={ui.icon} />
          <AppText variant="caption" style={[styles.flex, { color: colors.text }]} numberOfLines={1}>
            {guard.cooldown.active ? `Cooldown ${formatDuration(guard.cooldown.remainingMs)}` : (guard.reasons[0] ?? `${money(guard.riskRemaining)} risk left today`)}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}

      {guard ? (
        <TileGrid>
          <MetricTile label="Account balance" value={money(account.balance)} />
          <MetricTile label="Daily P&L" value={money(guard.realizedPnlToday, { sign: true })} tone={guard.realizedPnlToday > 0 ? 'positive' : guard.realizedPnlToday < 0 ? 'danger' : 'primary'} />
          <MetricTile label="Daily risk remaining" value={money(guard.riskRemaining)} tone={guard.riskRemaining <= 0 ? 'danger' : guard.riskUsedPct >= 0.6 ? 'warning' : 'primary'} />
          <MetricTile label="Trades remaining" value={`${guard.tradesRemaining} / ${guard.maxTrades}`} tone={guard.tradesRemaining === 0 ? 'danger' : 'primary'} />
          <MetricTile label="Drawdown remaining" value={money(guard.drawdownBuffer)} tone={guard.drawdownBuffer != null && guard.drawdownBuffer < 500 ? 'warning' : 'primary'} />
          <MetricTile
            label={consistency ? 'Consistency' : 'Discipline'}
            value={consistency ? (consistency.status === 'warning' || consistency.status === 'breached' ? 'Watch' : 'On Track') : String(score.score)}
            icon={consistency ? (consistency.status === 'warning' ? 'alert-circle' : 'checkmark-circle') : undefined}
            tone={consistency ? (consistency.status === 'warning' ? 'warning' : 'positive') : score.tone}
            onPress={() => router.push('/discipline')}
          />
        </TileGrid>
      ) : null}

      {openTrade ? (
        <Card tone="accent" onPress={() => router.push({ pathname: '/session/live', params: { id: openTrade.id } })}>
          <View style={styles.row}>
            <View style={styles.liveDot} />
            <AppText variant="label" tone="accent">
              Live trade monitor
            </AppText>
          </View>
          <AppText variant="heading" style={{ marginTop: spacing.sm }}>
            {openTrade.instrument} {openTrade.direction === 'long' ? 'Long' : 'Short'} {openTrade.contracts}
          </AppText>
          <AppText variant="caption">Tap to monitor the open position.</AppText>
        </Card>
      ) : null}

      {strategy ? (
        <TradingPlanCard strategy={strategy} guard={guard} />
      ) : (
        <Card>
          <EmptyState icon="git-branch-outline" title="No strategy yet" message="Prop Guard checks every trade against YOUR rules. Describe your strategy to begin." actionLabel="Build my strategy" onAction={() => router.push('/strategy')} />
        </Card>
      )}

      <Button label="Check Trade" icon="shield-checkmark" variant="success" onPress={() => router.push('/analyze')} />
      <View style={styles.row}>
        <Button label="Analyze Setup" icon="scan-outline" variant="secondary" size="md" style={styles.flex} onPress={() => router.push({ pathname: '/analyze', params: { mode: 'chart' } })} />
        <Button label="Risk Calc" icon="calculator-outline" variant="secondary" size="md" style={styles.flex} onPress={() => router.push('/calculator')} />
      </View>

      {todaysPlan ? (
        <Card onPress={() => router.push('/analyze')} tone="accent">
          <View style={styles.row}>
            <Ionicons name="document-text-outline" size={18} color={colors.accentBright} />
            <AppText variant="label" tone="accent">
              Saved trade plan
            </AppText>
          </View>
          <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
            {todaysPlan.instrument} {todaysPlan.direction === 'long' ? 'Long' : 'Short'} @ {todaysPlan.entry} · {todaysPlan.conditionsMet}/{todaysPlan.conditionsTotal} conditions
          </AppText>
        </Card>
      ) : null}

      {guard ? (
        <>
          <SectionHeader title="Recent insight" />
          <ProGate feature="aiCoach" title="AI Coach" description="A discipline-first coach that reviews your day in real time.">
            <CoachCard guard={guard} disciplineScore={score.score} strategyName={strategy?.name ?? null} lastSetupMatchPct={lastScore} />
          </ProGate>
        </>
      ) : null}

      <Card onPress={() => router.push('/discipline')} accessibilityLabel={`Discipline score ${score.score}, ${score.label}`}>
        <View style={styles.discRow}>
          <CircularScore value={score.score} tone={score.tone} size={72} stroke={7} />
          <View style={styles.flex}>
            <AppText variant="label">Discipline · 30 days</AppText>
            <AppText variant="heading" style={{ color: toneColor[score.tone].fg }}>
              {score.label}
            </AppText>
            {score.rulesTotal > 0 ? (
              <AppText variant="caption">
                Rules followed {score.rulesFollowed} / {score.rulesTotal}
              </AppText>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </View>
      </Card>

      <SectionHeader title="Recent trades" action={recent.length ? 'Journal' : undefined} onAction={() => router.push('/journal')} />
      {recent.length === 0 ? (
        <Card>
          <EmptyState icon="book-outline" title="No trades yet" message="Your journal will automatically organize your trading history." actionLabel="Check your first trade" onAction={() => router.push('/analyze')} />
        </Card>
      ) : (
        recent.map((t) => (
          <TradeCard
            key={t.id}
            trade={t}
            strategyName={t.strategyId ? names.get(t.strategyId) : null}
            onPress={() => router.push(t.status === 'open' ? { pathname: '/session/live', params: { id: t.id } } : { pathname: '/journal/[id]', params: { id: t.id } })}
          />
        ))
      )}
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, paddingVertical: spacing.md },
  headerRight: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  connRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  connDot: { width: 7, height: 7, borderRadius: 4 },
  progress: { marginTop: spacing.lg, gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  guard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
});
