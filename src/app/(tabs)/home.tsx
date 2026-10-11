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
import { CopyTradeHomeCard } from '@/features/copyTrade/CopyTradeHomeCard';
import { screenshotLabel } from '@/features/accountImport/ScreenshotStatus';
import { FIELD_LABEL, type FieldKey } from '@/lib/engines/accountImport';
import { drawdownFloor } from '@/lib/engines/propRuleEngine';
import { HomeModeCard } from '@/features/learning/HomeModeCard';
import { TradingPlanCard } from '@/features/home/TradingPlanCard';
import { useAccountTrades, useActiveAccount, useActiveStrategy, useDailyGuard, useDiscipline, useOpenTrade, usePendingTrades } from '@/hooks/useAppData';
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
  const pending = usePendingTrades();
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
      <Logo tagline />
      <View style={styles.headerRight}>
        <HeaderIconButton icon="layers-outline" label="Copy Trade" onPress={() => router.push('/copy')} />
        <HeaderIconButton icon="notifications-outline" label="Alerts" badge={unread} onPress={() => router.push('/alerts')} />
        <HeaderIconButton icon="settings-outline" label="Profile and settings" onPress={() => router.push('/profile')} />
      </View>
    </View>
  );

  if (!account) {
    return (
      <Screen tabBar header={header}>
        <HomeModeCard />
        <Card>
          <EmptyState illustration="shield" title="Add your trading account" message="Prop Guard needs your account limits before it can protect you." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
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
      <HomeModeCard />

      <Card accent="accent" onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: account.id } })} accessibilityLabel={`${account.name}, ${CONNECTION_LABEL[connection]}`}>
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
                {account.importState?.reported ? `Snapshot-based — not live verified · ${screenshotLabel(account.importState.reported.at)}` : CONNECTION_LABEL[connection]}
              </AppText>
            </View>
            {account.importState?.reported?.missing?.length ? (
              <AppText variant="caption" tone="tertiary" numberOfLines={2}>
                Not in the snapshot: {account.importState.reported.missing.map((k) => FIELD_LABEL[k as FieldKey] ?? k).join(', ')}
              </AppText>
            ) : null}
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
          <MetricTile
            label="Drawdown remaining"
            value={guard.drawdownUnknown ? 'Unknown' : money(guard.drawdownBuffer)}
            sub={guard.drawdownUnknown ? 'Additional account information required' : drawdownFloor(account) != null ? `Floor ${money(drawdownFloor(account))}` : undefined}
            tone={guard.drawdownUnknown || (guard.drawdownBuffer != null && guard.drawdownBuffer < 500) ? 'warning' : 'primary'}
          />
          {guard.dailyPnlSource === 'unknown' ? (
            <MetricTile label="Daily P&L" value="Unknown" sub="Not in the snapshot" />
          ) : (
            <MetricTile label="Daily P&L" value={money(guard.realizedPnlToday, { sign: true })} sub={guard.snapshot ? 'Journaled trades' : undefined} tone={guard.realizedPnlToday > 0 ? 'positive' : guard.realizedPnlToday < 0 ? 'danger' : 'primary'} />
          )}
          <MetricTile
            label="Firm daily loss limit"
            value={guard.firmDailyLimit != null ? money(guard.firmDailyLimit) : 'Not set'}
            sub={guard.firmDailyLimit != null ? (guard.dailyPnlSource === 'unknown' ? "Today's use unknown" : `${money(guard.firmDailyRoom)} left`) : undefined}
          />
          <MetricTile
            label="Your daily budget"
            value={guard.personalRoom != null ? money(guard.personalRoom) : 'Not set'}
            sub={guard.personalDailyStop != null ? `left of ${money(guard.personalDailyStop)} (your plan)` : undefined}
            tone={guard.personalRoom != null && guard.personalRoom <= 0 ? 'danger' : 'primary'}
          />
          <MetricTile label="Trades remaining" value={`${guard.tradesRemaining} / ${guard.maxTrades}`} tone={guard.tradesRemaining === 0 ? 'danger' : 'primary'} />
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

      {pending.length > 0 ? (
        <Card
          onPress={() =>
            pending.length === 1 ? router.push({ pathname: '/journal/complete/[id]', params: { id: pending[0].id } }) : router.push('/journal')
          }>
          <View style={styles.row}>
            <Ionicons name="book" size={16} color={colors.warning} />
            <AppText variant="label" tone="warning">
              {pending.length} trade{pending.length === 1 ? '' : 's'} waiting for a result
            </AppText>
          </View>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            {pending[0].instrument} {pending[0].direction === 'long' ? 'Long' : 'Short'} @ {pending[0].entry} — add the exit or a screenshot to finish the journal entry.
          </AppText>
        </Card>
      ) : null}

      {strategy ? (
        <TradingPlanCard strategy={strategy} guard={guard} />
      ) : (
        <Card>
          <EmptyState illustration="strategy" title="No strategy yet" message="Prop Guard checks every trade against YOUR rules. Describe your strategy to begin." actionLabel="Build my strategy" onAction={() => router.push('/strategy')} />
        </Card>
      )}

      <Button label="Check Trade" icon="shield-checkmark" variant="success" onPress={() => router.push('/analyze')} />
      {strategy ? <Button label="Today's Plan" icon="list-outline" variant="secondary" onPress={() => router.push('/session/today')} /> : null}
      <View style={styles.quick}>
        <QuickAction icon="scan-outline" label="Analyze Setup" onPress={() => router.push('/setup-check')} />
        <QuickAction icon="calculator-outline" label="Risk Calc" onPress={() => router.push('/calculator')} />
        <QuickAction icon="layers-outline" label="Copy Trade" onPress={() => router.push('/copy')} />
        <QuickAction icon="book-outline" label="Journal" onPress={() => router.push('/journal')} />
      </View>
      <CopyTradeHomeCard />

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
          <EmptyState illustration="trades" title="No trades yet" message="Your journal will automatically organize your trading history." actionLabel="Check your first trade" onAction={() => router.push('/analyze')} />
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

/** Icon tile for the dashboard's quick actions (consistent icon + label, one tap). */
function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.qa, pressed && styles.qaPressed]}>
      <View style={styles.qaIcon}>
        <Ionicons name={icon} size={20} color={colors.accentBright} />
      </View>
      <AppText variant="caption" tone="primary" numberOfLines={1} style={styles.qaLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', gap: spacing.sm },
  qa: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs + 2, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  qaPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  qaIcon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentBright + '33' },
  qaLabel: { fontSize: 12, fontWeight: '600' },
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
