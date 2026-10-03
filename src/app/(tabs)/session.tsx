import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { DailyGuardCard } from '@/components/domain/DailyGuardCard';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  HeaderIconButton,
  Metric,
  NumericInput,
  Screen,
  SectionHeader,
  SegmentedControl,
  StatusBadge,
  YesNo,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { useSetupEvaluation } from '@/features/session/useSetupEvaluation';
import { useActiveAccount, useActiveStrategy, useDailyGuard, useOpenTrade } from '@/hooks/useAppData';
import { INSTRUMENT_SYMBOLS, maxContractsForRisk } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { formatDuration } from '@/utils/dates';
import { money, parseNum, points, rr } from '@/utils/format';

export default function SessionScreen() {
  const account = useActiveAccount();
  const activeStrategy = useActiveStrategy();
  const strategies = useAppStore((s) => s.strategies);
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const patchDraft = useAppStore((s) => s.patchDraft);
  const rules = useAppStore((s) => s.tradingRules);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const guard = useDailyGuard(true);
  const openTrade = useOpenTrade();
  const { risk, strategy } = useSetupEvaluation(draft);

  useEffect(() => {
    if (!draft) setDraft(newDraft(activeStrategy, defaultInstrument));
  }, [draft, activeStrategy, defaultInstrument, setDraft]);

  if (!account) {
    return (
      <Screen tabBar header={<AppHeader title="Pre-trade check" />}>
        <EmptyState
          icon="briefcase-outline"
          title="Add a trading account"
          message="Daily Guard needs your account limits before it can protect you."
          actionLabel="Add account"
          onAction={() => router.push('/accounts/new')}
        />
      </Screen>
    );
  }

  if (!draft || !guard) return <Screen tabBar header={<AppHeader title="Pre-trade check" />}>{null}</Screen>;

  const n = { entry: parseNum(draft.entry), stop: parseNum(draft.stop) };
  const sizing =
    n.entry != null && n.stop != null && n.entry !== n.stop
      ? maxContractsForRisk(draft.instrument, n.entry, n.stop, Math.min(rules.maxRiskPerTrade, guard.riskRemaining), account.rules.maxContracts)
      : null;
  const yesNoItems = strategy?.checklist.filter((c) => c.kind === 'yesno') ?? [];
  const locked = guard.cooldown.active;

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          title="Pre-trade check"
          subtitle={account.name}
          right={
            <>
              <HeaderIconButton icon="scan-outline" label="Analyze screenshot" onPress={() => router.push('/session/screenshot')} />
              <HeaderIconButton icon="refresh" label="Reset checklist" onPress={() => setDraft(newDraft(strategy ?? activeStrategy, draft.instrument))} />
            </>
          }
        />
      }>
      {openTrade ? (
        <Card tone="accent" onPress={() => router.push({ pathname: '/session/live', params: { id: openTrade.id } })}>
          <AppText variant="label" tone="accent">
            Live trade open
          </AppText>
          <AppText variant="heading" style={{ marginTop: spacing.xs }}>
            {openTrade.instrument} {openTrade.direction.toUpperCase()} — tap to manage
          </AppText>
        </Card>
      ) : null}

      {guard.status === 'STOP' || locked ? (
        <DailyGuardCard guard={guard} detailed />
      ) : (
        <Card>
          <View style={styles.guardMini}>
            <StatusBadge label={guard.status === 'SAFE' ? 'Safe to trade' : guard.headline} tone={guard.status === 'SAFE' ? 'positive' : 'warning'} icon={guard.status === 'SAFE' ? 'shield-checkmark' : 'alert-circle'} />
            <AppText variant="caption">
              {money(guard.riskRemaining)} risk · {guard.tradesRemaining} trade{guard.tradesRemaining === 1 ? '' : 's'} left
            </AppText>
          </View>
        </Card>
      )}

      {locked ? (
        <Card tone="warning">
          <View style={styles.lockRow}>
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
            <AppText variant="label" tone="warning">
              New trade locked
            </AppText>
          </View>
          <AppText variant="display" tone="warning" style={{ marginTop: spacing.sm }}>
            {formatDuration(guard.cooldown.remainingMs)}
          </AppText>
          <AppText variant="caption">
            Cooldown after a loss. {rules.allowCooldownOverride ? 'You can still check a setup, but entering will be recorded as an override.' : 'Overrides are disabled in your rules.'}
          </AppText>
        </Card>
      ) : null}

      <SectionHeader title="Strategy" action={strategies.length ? 'Manage' : undefined} onAction={() => router.push('/strategy')} />
      {strategies.length === 0 ? (
        <Card>
          <EmptyState icon="git-branch-outline" title="No strategy" message="The Trade Checker compares every setup to a strategy you define." actionLabel="Create strategy" onAction={() => router.push('/strategy')} />
        </Card>
      ) : (
        <View style={styles.chips}>
          {strategies.map((s) => (
            <Chip key={s.id} label={s.name} selected={draft.strategyId === s.id} onPress={() => patchDraft({ strategyId: s.id, answers: {} })} />
          ))}
        </View>
      )}

      <SegmentedControl
        label="Instrument"
        options={INSTRUMENT_SYMBOLS.map((s) => ({ value: s, label: s }))}
        value={draft.instrument}
        onChange={(v) => patchDraft({ instrument: v })}
      />

      <SegmentedControl
        label="Direction"
        options={[
          { value: 'long', label: 'Long', tone: 'positive' },
          { value: 'short', label: 'Short', tone: 'danger' },
        ]}
        value={draft.direction}
        onChange={(v) => patchDraft({ direction: v })}
      />

      {strategy ? (
        <>
          <SegmentedControl
            label={strategy.biasRequirement ? `${strategy.biasRequirement} bias` : 'Higher-timeframe bias'}
            options={[
              { value: 'bullish', label: 'Bullish', tone: 'positive' },
              { value: 'bearish', label: 'Bearish', tone: 'danger' },
              { value: 'neutral', label: 'Neutral' },
            ]}
            value={draft.bias}
            onChange={(v) => patchDraft({ bias: v })}
          />
          {yesNoItems.length > 0 ? (
            <Card>
              <View style={styles.checklist}>
                {yesNoItems.map((item) => (
                  <YesNo
                    key={item.id}
                    label={`${item.label}?`}
                    value={draft.answers[item.id] ?? null}
                    onChange={(v) => patchDraft({ answers: { ...draft.answers, [item.id]: v } })}
                  />
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionHeader title="Trade plan" />
      {draft.source === 'screenshot' ? <StatusBadge label="Values confirmed from screenshot" tone="accent" icon="scan" size="sm" /> : null}
      <View style={styles.inputs}>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={draft.entry} onChangeText={(t) => patchDraft({ entry: t })} placeholder="6042.25" large />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Contracts" value={draft.contracts} onChangeText={(t) => patchDraft({ contracts: t.replace(/\D/g, '') })} keyboardType="number-pad" large />
        </View>
      </View>
      <View style={styles.inputs}>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={draft.stop} onChangeText={(t) => patchDraft({ stop: t })} placeholder="6037.25" large />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Target" value={draft.target} onChangeText={(t) => patchDraft({ target: t })} placeholder="6052.25" large />
        </View>
      </View>

      <Card raised>
        <View style={styles.metrics}>
          <Metric label="Risk" value={money(risk?.riskDollars)} tone={risk?.riskDollars != null && risk.riskDollars > rules.maxRiskPerTrade ? 'danger' : undefined} />
          <Metric label="Reward" value={money(risk?.rewardDollars)} tone={risk?.rewardDollars ? 'positive' : undefined} />
          <Metric label="R:R" value={rr(risk?.rr)} />
        </View>
        <View style={[styles.metrics, { marginTop: spacing.lg }]}>
          <Metric label="Pts risk" value={points(risk?.pointsRisk)} compact />
          <Metric label="Pts reward" value={points(risk?.pointsReward)} compact />
          <Metric label="Acct risk" value={risk?.accountRiskPct != null ? `${risk.accountRiskPct.toFixed(2)}%` : '—'} compact />
        </View>
        {sizing != null ? (
          <AppText variant="caption" style={{ marginTop: spacing.md }}>
            Max size within your limits: {sizing} {draft.instrument}
          </AppText>
        ) : null}
        {risk && !risk.valid && (draft.entry || draft.stop) && risk.errors.length > 0 ? (
          <AppText variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>
            {risk.errors[0]}
          </AppText>
        ) : null}
      </Card>

      <Button
        label="Check trade"
        icon="shield-checkmark"
        disabled={!strategy || !risk}
        onPress={() => router.push('/session/check')}
        accessibilityHint="Evaluates this setup against your strategy and rules"
      />
      <View style={styles.row}>
        <Button label="Session review" variant="secondary" size="md" icon="stats-chart-outline" onPress={() => router.push('/session/review')} style={styles.flex} />
        <Button label="Calculator" variant="secondary" size="md" icon="calculator-outline" onPress={() => router.push('/calculator')} style={styles.flex} />
      </View>
      <Card>
        <View style={styles.lockRow}>
          <Ionicons name="link-outline" size={16} color={colors.textSecondary} />
          <AppText variant="label">Connected broker — coming soon</AppText>
        </View>
        <AppText variant="caption" style={{ marginTop: spacing.xs }}>
          Tradovate, NinjaTrader, ProjectX and Rithmic-compatible connections are planned. Manual and screenshot modes work today.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  guardMini: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  checklist: { gap: spacing.lg },
  inputs: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  metrics: { flexDirection: 'row', gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
});
