import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DailyGuardCard } from '@/components/domain/DailyGuardCard';
import { GUARD_UI } from '@/components/domain/guardUi';
import { ProGate } from '@/components/domain/ProGate';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  EmptyState,
  FieldRow,
  HeaderIconButton,
  Input,
  Metric,
  Screen,
  SectionHeader,
  SegmentedControl,
  SelectField,
  StatusBadge,
  Stepper,
  TabSwitch,
  YesNo,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ChartImport } from '@/features/analyze/ChartImport';
import { newDraft } from '@/features/session/draft';
import { useSetupEvaluation } from '@/features/session/useSetupEvaluation';
import { useActiveAccount, useActiveStrategy, useDailyGuard, useOpenTrade } from '@/hooks/useAppData';
import { getInstrument, INSTRUMENT_SYMBOLS, maxContractsForRisk } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { formatDuration } from '@/utils/dates';
import { money, parseNum, points, rr } from '@/utils/format';

type Mode = 'manual' | 'chart';

export default function AnalyzeScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const account = useActiveAccount();
  const activeStrategy = useActiveStrategy();
  const strategies = useAppStore((s) => s.strategies);
  const plans = useAppStore((s) => s.plans);
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const patchDraft = useAppStore((s) => s.patchDraft);
  const setPlanStatus = useAppStore((s) => s.setPlanStatus);
  const rules = useAppStore((s) => s.tradingRules);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const guard = useDailyGuard(true);
  const openTrade = useOpenTrade();
  const { risk, strategy } = useSetupEvaluation(draft);
  const [mode, setMode] = useState<Mode>(params.mode === 'chart' ? 'chart' : 'manual');

  // Follow ?mode= when another screen links here (e.g. Home "Analyze Setup").
  const [lastParam, setLastParam] = useState(params.mode);
  if (params.mode !== lastParam) {
    setLastParam(params.mode);
    if (params.mode === 'chart' || params.mode === 'manual') setMode(params.mode);
  }

  useEffect(() => {
    if (!draft) setDraft(newDraft(activeStrategy, defaultInstrument));
  }, [draft, activeStrategy, defaultInstrument, setDraft]);

  if (!account) {
    return (
      <Screen tabBar header={<AppHeader title="Check trade" />}>
        <EmptyState icon="briefcase-outline" title="Add a trading account" message="Daily Guard needs your account limits before it can protect you." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
      </Screen>
    );
  }
  if (!draft || !guard) return <Screen tabBar header={<AppHeader title="Check trade" />}>{null}</Screen>;

  const entry = parseNum(draft.entry);
  const stop = parseNum(draft.stop);
  const contracts = Math.max(1, Math.round(parseNum(draft.contracts) ?? 1));
  const sizing =
    entry != null && stop != null && entry !== stop
      ? maxContractsForRisk(draft.instrument, entry, stop, Math.min(rules.maxRiskPerTrade, guard.riskRemaining), account.rules.maxContracts)
      : null;
  const yesNoItems = strategy?.checklist.filter((c) => c.kind === 'yesno') ?? [];
  const answered = yesNoItems.filter((c) => draft.answers[c.id] != null).length;
  const savedPlans = plans.filter((p) => p.status === 'saved' && p.accountId === account.id).slice(0, 3);
  const ui = GUARD_UI[guard.status];
  const overRisk = risk?.riskDollars != null && risk.riskDollars > rules.maxRiskPerTrade;

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          title="Check trade"
          subtitle={account.name}
          right={
            <>
              <HeaderIconButton icon="school-outline" label="Practice mode" onPress={() => router.push('/practice')} />
              <HeaderIconButton icon="refresh" label="Reset trade" onPress={() => setDraft(newDraft(strategy ?? activeStrategy, draft.instrument))} />
            </>
          }
        />
      }>
      {openTrade ? (
        <Card tone="accent" onPress={() => router.push({ pathname: '/session/live', params: { id: openTrade.id } })}>
          <View style={styles.row}>
            <View style={styles.liveDot} />
            <AppText variant="label" tone="accent">
              Live trade open
            </AppText>
          </View>
          <AppText variant="heading" style={{ marginTop: spacing.xs }}>
            {openTrade.instrument} {openTrade.direction === 'long' ? 'Long' : 'Short'} — tap to monitor
          </AppText>
        </Card>
      ) : null}

      {guard.status === 'STOP' || guard.cooldown.active ? (
        <DailyGuardCard guard={guard} detailed />
      ) : (
        <View style={styles.guardRow}>
          <StatusBadge label={guard.status === 'SAFE' ? ui.label : guard.headline} tone={ui.tone} icon={ui.icon} />
          <AppText variant="caption">
            {money(guard.riskRemaining)} risk · {guard.tradesRemaining} trade{guard.tradesRemaining === 1 ? '' : 's'} left
          </AppText>
        </View>
      )}
      {guard.cooldown.active ? (
        <Card tone="warning">
          <View style={styles.row}>
            <Ionicons name="lock-closed" size={18} color={colors.warning} />
            <AppText variant="label" tone="warning">
              New trade locked · {formatDuration(guard.cooldown.remainingMs)}
            </AppText>
          </View>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            {rules.allowCooldownOverride ? 'You can still check a setup; entering will be recorded as an override.' : 'Overrides are disabled in your rules.'}
          </AppText>
        </Card>
      ) : null}

      <TabSwitch
        options={[
          { value: 'manual', label: 'Manual Entry' },
          { value: 'chart', label: 'From Chart' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'chart' ? (
        <ProGate feature="screenshotAnalysis" title="Screenshot analysis" description="Upload a TradingView, Tradovate or NinjaTrader screenshot and extract the trade plan.">
          <ChartImport
            cta="Use values for trade check"
            onUse={(v) => {
              patchDraft({ instrument: v.instrument, direction: v.direction, entry: v.entry, stop: v.stop, target: v.target, source: 'screenshot', screenshotUri: v.imageUri });
              setMode('manual');
            }}
          />
        </ProGate>
      ) : (
        <>
          {strategies.length === 0 ? (
            <Card>
              <EmptyState icon="git-branch-outline" title="No strategy" message="The trade check compares every setup to a strategy you define." actionLabel="Build my strategy" onAction={() => router.push('/strategy')} />
            </Card>
          ) : null}

          <Card>
            <View style={styles.row}>
              <View style={styles.flex}>
                <SelectField
                  label="Instrument"
                  value={draft.instrument}
                  options={INSTRUMENT_SYMBOLS.map((s) => ({ value: s, label: s === 'ES' ? 'ES (S&P 500)' : s === 'NQ' ? 'NQ (Nasdaq)' : s, sub: getInstrument(s).name }))}
                  onChange={(v) => patchDraft({ instrument: v })}
                />
              </View>
              <View style={styles.flex}>
                <SegmentedControl
                  options={[
                    { value: 'long', label: 'Long', tone: 'positive' },
                    { value: 'short', label: 'Short', tone: 'danger' },
                  ]}
                  value={draft.direction}
                  onChange={(v) => patchDraft({ direction: v })}
                />
              </View>
            </View>
            {draft.source === 'screenshot' ? (
              <View style={{ marginTop: spacing.md }}>
                <StatusBadge label="Values confirmed from chart" tone="accent" icon="scan" size="sm" />
              </View>
            ) : null}
            <View style={styles.fields}>
              <FieldRow label="Entry Price" value={draft.entry} onChangeText={(t) => patchDraft({ entry: t })} placeholder="6742.00" />
              <FieldRow label="Stop Price" value={draft.stop} onChangeText={(t) => patchDraft({ stop: t })} placeholder="6737.00" />
              <FieldRow label="Target Price" value={draft.target} onChangeText={(t) => patchDraft({ target: t })} placeholder="6752.00" />
              <FieldRow label="Contracts" control={<Stepper label="Contracts" value={contracts} onChange={(n) => patchDraft({ contracts: String(n) })} max={account.rules.maxContracts ?? 99} />} />
              {strategies.length > 0 ? (
                <FieldRow
                  label="Setup Type"
                  control={
                    <SelectField
                      label="Setup type"
                      value={draft.strategyId}
                      options={strategies.map((s) => ({ value: s.id, label: s.name, sub: `${s.checklist.length} conditions · min 1:${s.minRR}` }))}
                      onChange={(v) => patchDraft({ strategyId: v, answers: {} })}
                    />
                  }
                />
              ) : null}
            </View>
          </Card>

          <Card raised>
            <View style={styles.metrics}>
              <Metric label="Risk" value={money(risk?.riskDollars)} tone={overRisk ? 'danger' : undefined} sub={risk?.pointsRisk != null ? points(risk.pointsRisk) : undefined} />
              <Metric label="Reward" value={money(risk?.rewardDollars)} tone={risk?.rewardDollars ? 'positive' : undefined} sub={risk?.pointsReward != null ? points(risk.pointsReward) : undefined} />
              <Metric label="R:R" value={rr(risk?.rr)} />
            </View>
            {sizing != null ? (
              <AppText variant="caption" style={{ marginTop: spacing.md }}>
                Max size within your limits: <AppText variant="bodyStrong" style={{ fontSize: 13 }}>{sizing} {draft.instrument}</AppText>
              </AppText>
            ) : null}
            {risk && !risk.valid && (draft.entry || draft.stop) && risk.errors.length > 0 ? (
              <AppText variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>
                {risk.errors[0]}
              </AppText>
            ) : null}
          </Card>

          {strategy ? (
            <>
              <SectionHeader title={`Confirm conditions · ${answered}/${yesNoItems.length}`} action="View plan" onAction={() => router.push({ pathname: '/strategy/review', params: { id: strategy.id } })} />
              <Card>
                <View style={styles.checklist}>
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
                  {yesNoItems.map((item) => (
                    <YesNo key={item.id} label={item.label} value={draft.answers[item.id] ?? null} onChange={(v) => patchDraft({ answers: { ...draft.answers, [item.id]: v } })} />
                  ))}
                </View>
              </Card>
            </>
          ) : null}

          <Input label="Notes (optional)" value={draft.notes ?? ''} onChangeText={(t) => patchDraft({ notes: t })} multiline placeholder="Retest of 5m OB after ORB. Good volume." />

          <Button label="Analyze Entry" icon="shield-checkmark" disabled={!strategy || !risk} onPress={() => router.push('/session/check')} accessibilityHint="Checks this setup against your strategy and rules" />
        </>
      )}

      {savedPlans.length > 0 ? (
        <>
          <SectionHeader title="Saved trade plans" />
          {savedPlans.map((p) => (
            <Card
              key={p.id}
              onPress={() => {
                setDraft({
                  ...newDraft(strategies.find((s) => s.id === p.strategyId) ?? activeStrategy, p.instrument),
                  strategyId: p.strategyId,
                  direction: p.direction,
                  entry: String(p.entry),
                  stop: String(p.stop),
                  target: p.target != null ? String(p.target) : '',
                  contracts: String(p.contracts),
                  notes: p.notes,
                  planId: p.id,
                });
                setMode('manual');
              }}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">
                    {p.instrument} {p.direction === 'long' ? 'Long' : 'Short'} · {p.entry} / {p.stop} / {p.target ?? '—'}
                  </AppText>
                  <AppText variant="caption">
                    {money(p.riskDollars)} risk · {rr(p.rr)} · {p.conditionsMet}/{p.conditionsTotal} conditions
                  </AppText>
                </View>
                <Button label="Discard" variant="ghost" size="md" onPress={() => setPlanStatus(p.id, 'discarded')} />
              </View>
            </Card>
          ))}
        </>
      ) : null}

      <Card>
        <View style={styles.row}>
          <Ionicons name="link-outline" size={16} color={colors.textSecondary} />
          <AppText variant="label">Connected broker — coming soon</AppText>
        </View>
        <AppText variant="caption" style={{ marginTop: spacing.xs }}>
          Tradovate, NinjaTrader, ProjectX and Rithmic connections are planned. Manual and chart modes work today.
        </AppText>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  guardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  fields: { marginTop: spacing.sm },
  metrics: { flexDirection: 'row', gap: spacing.md },
  checklist: { gap: spacing.lg },
});
