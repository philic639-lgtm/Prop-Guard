import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AccountSelector } from '@/components/domain/AccountSelector';
import { DailyGuardCard } from '@/components/domain/DailyGuardCard';
import { DemoBanner } from '@/components/domain/DemoBanner';
import { Disclaimer } from '@/components/domain/Disclaimer';
import { ProGate } from '@/components/domain/ProGate';
import { TradeCard } from '@/components/domain/TradeCard';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  CircularScore,
  EmptyState,
  HeaderIconButton,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { colors, radius, spacing, toneColor } from '@/constants/theme';
import { CoachCard } from '@/features/home/CoachCard';
import { useAccountTrades, useActiveStrategy, useDailyGuard, useDiscipline, useOpenTrade } from '@/hooks/useAppData';
import { useNow } from '@/hooks/useNow';
import { useAppStore } from '@/store/useAppStore';
import { greeting } from '@/utils/dates';

export default function HomeScreen() {
  const now = useNow(60_000);
  const name = useAppStore((s) => s.preferences.displayName);
  const draftBias = useAppStore((s) => s.draft?.bias ?? null);
  const strategies = useAppStore((s) => s.strategies);
  const guard = useDailyGuard(true);
  const strategy = useActiveStrategy();
  const trades = useAccountTrades();
  const openTrade = useOpenTrade();
  const { score } = useDiscipline(30);
  const recent = useMemo(() => trades.slice(0, 3), [trades]);
  const names = useMemo(() => new Map(strategies.map((s) => [s.id, s.name])), [strategies]);
  const lastScore = trades.find((t) => t.setupScore != null)?.setupScore ?? null;

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          brand
          right={<HeaderIconButton icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} />}
        />
      }>
      <View style={styles.greeting}>
        <AppText variant="title">{greeting(now)}</AppText>
        {name ? <AppText variant="caption">{name.split(' ')[0]}, trade the plan. Protect the account.</AppText> : null}
        <DemoBanner />
      </View>

      <AccountSelector />

      {openTrade ? (
        <Card tone="accent" onPress={() => router.push({ pathname: '/session/live', params: { id: openTrade.id } })}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <AppText variant="label" tone="accent">
              Live trade
            </AppText>
          </View>
          <AppText variant="heading" style={{ marginTop: spacing.sm }}>
            {openTrade.instrument} {openTrade.direction.toUpperCase()} · {openTrade.contracts} ct
          </AppText>
          <AppText variant="caption">Tap to manage the open position.</AppText>
        </Card>
      ) : null}

      {guard ? (
        <>
          <SectionHeader title="Today's Guard" action="Details" onAction={() => router.push('/session')} />
          <DailyGuardCard guard={guard} onPress={() => router.push('/session')} />
          <ProGate feature="aiCoach" title="AI Coach" description="A discipline-first coach that reviews your day in real time.">
            <CoachCard guard={guard} disciplineScore={score.score} strategyName={strategy?.name ?? null} lastSetupMatchPct={lastScore} />
          </ProGate>
        </>
      ) : null}

      <SectionHeader title="Current Strategy" action={strategy ? 'Change' : undefined} onAction={() => router.push('/strategy')} />
      {strategy ? (
        <Card>
          <AppText variant="title">{strategy.name}</AppText>
          <View style={styles.stratRows}>
            <View style={styles.kv}>
              <AppText variant="caption">Bias</AppText>
              <AppText variant="bodyStrong" style={{ textTransform: 'capitalize' }}>
                {draftBias ?? 'Set in pre-trade check'}
              </AppText>
            </View>
            <View style={styles.kv}>
              <AppText variant="caption">Setup</AppText>
              <AppText variant="bodyStrong">{openTrade ? 'In trade' : 'Waiting for confirmation'}</AppText>
            </View>
          </View>
          <Button
            label={guard?.status === 'STOP' ? 'Review session' : 'Start session'}
            icon={guard?.status === 'STOP' ? 'stats-chart' : 'play'}
            variant={guard?.status === 'STOP' ? 'secondary' : 'primary'}
            onPress={() => router.push(guard?.status === 'STOP' ? '/session/review' : '/session')}
            style={{ marginTop: spacing.lg }}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon="git-branch-outline"
            title="No strategy yet"
            message="Prop Guard checks every trade against YOUR rules. Build or pick a strategy to begin."
            actionLabel="Choose a strategy"
            onAction={() => router.push('/strategy')}
          />
        </Card>
      )}

      <SectionHeader title="Discipline" action="Breakdown" onAction={() => router.push('/discipline')} />
      <ProGate feature="disciplineScore" title="Discipline Score" description="Measure rule adherence — not P/L — across every session.">
        <Card onPress={() => router.push('/discipline')} accessibilityLabel={`Discipline score ${score.score}, ${score.label}`}>
          <View style={styles.discRow}>
            <CircularScore value={score.score} tone={score.tone} size={96} stroke={8} label="Score" />
            <View style={styles.discText}>
              <AppText variant="heading" style={{ color: toneColor[score.tone].fg }}>
                {score.label}
              </AppText>
              <AppText variant="caption">Last 30 days</AppText>
              {score.rulesTotal > 0 ? (
                <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
                  Rules followed {score.rulesFollowed} / {score.rulesTotal}
                </AppText>
              ) : null}
            </View>
          </View>
        </Card>
      </ProGate>

      <View style={styles.quick}>
        <QuickAction icon="calculator-outline" label="Risk calc" onPress={() => router.push('/calculator')} />
        <QuickAction icon="scan-outline" label="Screenshot" onPress={() => router.push('/session/screenshot')} />
        <QuickAction icon="stats-chart-outline" label="Analytics" onPress={() => router.push('/analytics')} />
      </View>

      <SectionHeader title="Recent Activity" action={recent.length ? 'Journal' : undefined} onAction={() => router.push('/journal')} />
      {recent.length === 0 ? (
        <Card>
          <EmptyState
            icon="book-outline"
            title="No trades yet"
            message="Your journal will automatically organize your trading history."
            actionLabel="Start first session"
            onAction={() => router.push('/session')}
          />
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

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.qa, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <AppText variant="caption" tone="primary" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  greeting: { gap: spacing.xs + 2 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  stratRows: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.lg },
  kv: { flex: 1, gap: 2 },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  discText: { flex: 1, gap: 2 },
  quick: { flexDirection: 'row', gap: spacing.md },
  qa: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
