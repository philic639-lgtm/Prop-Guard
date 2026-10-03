import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GRADE_UI } from '@/components/domain/guardUi';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  CircularScore,
  ConfirmationSheet,
  LoadingState,
  Metric,
  RuleChecklist,
  Screen,
  StatusBadge,
  WarningSheet,
} from '@/components/ui';
import { AI_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { draftNumbers, useSetupEvaluation } from '@/features/session/useSetupEvaluation';
import { useActiveAccount } from '@/hooks/useAppData';
import { aiService, type SetupAnalysis } from '@/services/ai';
import { notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';
import { useEntitlement } from '@/store/useSubscriptionStore';
import type { DisciplineCategory, DisciplineEventType, Trade } from '@/types/domain';
import { uuid } from '@/utils/id';
import { money, rr } from '@/utils/format';

type ViolationEvent = { type: DisciplineEventType; category: DisciplineCategory; detail: string };

export default function SetupCheckScreen() {
  const draft = useAppStore((s) => s.draft);
  const rules = useAppStore((s) => s.tradingRules);
  const prefs = useAppStore((s) => s.preferences.notifications);
  const store = useAppStore.getState;
  const account = useActiveAccount();
  const { risk, evaluation, strategy, guard } = useSetupEvaluation(draft);
  const aiAllowed = useEntitlement('aiTradeChecker');
  const [analysis, setAnalysis] = useState<SetupAnalysis | null>(null);
  const [sheet, setSheet] = useState<'none' | 'caution' | 'violation'>('none');

  const evalKey = evaluation ? `${evaluation.grade}|${evaluation.matchPct}|${evaluation.violations.length}|${evaluation.cautions.length}` : '';

  useEffect(() => {
    if (!evaluation || !strategy || !draft || !guard || !aiAllowed) return;
    let alive = true;
    // Minimized payload: no account names, balances or identifiers.
    aiService
      .analyzeTradeSetup({
        strategy: {
          name: strategy.name,
          entryTrigger: strategy.entryTrigger,
          confirmationRules: strategy.confirmationRules,
          retestRules: strategy.retestRules,
          invalidationRules: strategy.invalidationRules,
          minRR: strategy.minRR,
          typicalStop: [strategy.typicalStopMin, strategy.typicalStopMax],
        },
        trade: {
          instrument: draft.instrument,
          direction: draft.direction,
          bias: draft.bias,
          pointsRisk: risk?.pointsRisk ?? null,
          pointsReward: risk?.pointsReward ?? null,
          rr: risk?.rr ?? null,
          contracts: draftNumbers(draft).contracts ?? 0,
        },
        evaluation: {
          grade: evaluation.grade,
          matchPct: evaluation.matchPct,
          passed: evaluation.checks.filter((c) => c.passed).map((c) => c.label),
          failed: evaluation.checks.filter((c) => !c.passed).map((c) => c.label),
          cautions: evaluation.cautions,
          violations: evaluation.violations,
        },
        context: { riskRemaining: guard.riskRemaining, tradesRemaining: guard.tradesRemaining, consecutiveLosses: guard.consecutiveLosses },
      })
      .then((a) => alive && setAnalysis(a))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalKey, aiAllowed]);

  const violationEvents = useMemo<ViolationEvent[]>(() => {
    if (!evaluation || !guard) return [];
    const failed = new Set(evaluation.rulesViolated);
    const out: ViolationEvent[] = [];
    if (failed.has('risk_per_trade') || failed.has('risk_daily') || failed.has('max_contracts') || (guard.dailyLimit > 0 && guard.riskRemaining <= 0)) {
      out.push({ type: 'RULE_OVERRIDDEN', category: 'risk', detail: 'Entered with risk outside configured limits.' });
    }
    if (failed.has('cooldown')) {
      out.push({ type: 'COOLDOWN_BROKEN', category: 'cooldown', detail: `Entered during the ${rules.cooldownMinutes}-minute cooldown.` });
    }
    if (failed.has('strategy_max_trades') || (guard.maxTrades > 0 && guard.tradesRemaining <= 0)) {
      out.push({ type: 'RULE_OVERRIDDEN', category: 'trade_limit', detail: 'Entered beyond the configured trade limit.' });
    }
    if (failed.has('min_rr') || failed.has('target_set')) {
      out.push({ type: 'STRATEGY_VIOLATION', category: 'strategy', detail: 'Trade plan did not meet strategy R:R / target rules.' });
    }
    if ([...failed].some((id) => id.startsWith('check_') || id === 'bias_aligned')) {
      out.push({ type: 'STRATEGY_VIOLATION', category: 'entry', detail: 'Entered without all strategy checklist items confirmed.' });
    }
    return out;
  }, [evaluation, guard, rules.cooldownMinutes]);

  if (!draft || !account) {
    return (
      <Screen header={<AppHeader title="Setup check" back />}>
        <LoadingState />
      </Screen>
    );
  }

  if (!evaluation || !risk || !strategy || !guard) {
    return (
      <Screen header={<AppHeader title="Setup check" back />}>
        <Card>
          <AppText variant="heading">Select a strategy first</AppText>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            The checker compares your trade to a strategy you define.
          </AppText>
        </Card>
      </Screen>
    );
  }

  const ui = GRADE_UI[evaluation.grade];
  const cooldownBlocked = guard.cooldown.active && !rules.allowCooldownOverride;
  const canEnter = risk.valid && !cooldownBlocked;

  const enterTrade = () => {
    const n = draftNumbers(draft);
    const session = store().ensureSession();
    const id = uuid();
    const now = new Date().toISOString();
    const disciplineScore = Math.max(0, 100 - violationEvents.length * 25);
    const trade: Trade = {
      id,
      accountId: account.id,
      strategyId: strategy.id,
      sessionId: session?.id ?? null,
      instrument: draft.instrument,
      direction: draft.direction,
      entryPrice: n.entry!,
      stopPrice: n.stop!,
      originalStopPrice: n.stop!,
      targetPrice: n.target,
      exitPrice: null,
      contracts: n.contracts!,
      riskDollars: risk.riskDollars!,
      rewardDollars: risk.rewardDollars,
      rMultiple: risk.rr,
      realizedR: null,
      pnl: null,
      points: null,
      status: 'open',
      openedAt: now,
      closedAt: null,
      bias: draft.bias,
      checklist: strategy.checklist
        .filter((c) => c.kind === 'yesno')
        .map((c) => ({ itemId: c.id, label: c.label, value: draft.answers[c.id] === true })),
      rulesFollowed: evaluation.rulesFollowed,
      rulesViolated: evaluation.rulesViolated.filter((r) => r !== 'entry_window'),
      setupScore: evaluation.matchPct,
      setupGrade: evaluation.grade,
      disciplineScore,
      notes: '',
      aiSummary: analysis?.summary ?? null,
      emotion: null,
      setupRating: null,
      screenshotUri: draft.screenshotUri,
      source: draft.source,
      journaled: false,
      mae: null,
      mfe: null,
    };
    store().openTrade(trade);
    const base = { accountId: account.id, tradeId: id, sessionId: session?.id ?? null };
    if (violationEvents.length === 0) {
      store().recordEvent({ ...base, type: 'RULE_FOLLOWED', category: 'strategy', detail: `${ui.label} — all rules followed.` });
    }
    for (const v of violationEvents) store().recordEvent({ ...base, ...v });

    // Trade-limit notification when this entry uses the last allowed trade.
    if (guard.tradesRemaining <= 1) void notificationService.notifyNow('tradeLimit', prefs);
    const usedAfter = guard.riskUsed + risk.riskDollars!;
    if (guard.dailyLimit > 0 && usedAfter / guard.dailyLimit >= 0.75) void notificationService.notifyNow('lossLimit', prefs);

    store().setDraft({ ...newDraft(strategy, draft.instrument), bias: draft.bias });
    setSheet('none');
    router.dismissAll();
    router.push({ pathname: '/session/live', params: { id } });
  };

  const onEnterPress = () => {
    if (evaluation.grade === 'A_PLUS' || evaluation.grade === 'VALID') {
      if (violationEvents.length === 0) return enterTrade();
    }
    if (evaluation.grade === 'CAUTION' && violationEvents.every((v) => v.category === 'entry')) return setSheet('caution');
    setSheet('violation');
  };

  const rows = evaluation.checks.map((c) => ({
    id: c.id,
    label: c.label,
    state: c.passed ? ('pass' as const) : c.severity === 'context' ? ('warn' as const) : ('fail' as const),
    detail: c.detail,
  }));

  return (
    <Screen
      header={<AppHeader title="Setup check" back />}
      footer={
        <>
          <Button
            label={evaluation.grade === 'NO_TRADE' || evaluation.grade === 'RULE_VIOLATION' ? 'Enter anyway' : 'Enter trade'}
            variant={evaluation.grade === 'NO_TRADE' || evaluation.grade === 'RULE_VIOLATION' ? 'secondary' : 'primary'}
            icon="enter-outline"
            disabled={!canEnter}
            onPress={onEnterPress}
          />
          <Button label="Modify trade" variant="ghost" onPress={() => router.back()} />
        </>
      }>
      <View style={styles.hero}>
        <CircularScore value={evaluation.matchPct} suffix="%" tone={ui.tone} size={150} stroke={12} label="Strategy match" />
        <StatusBadge label={ui.label} tone={ui.tone} icon={ui.icon} size="lg" />
        <AppText variant="caption" align="center">
          {strategy.name} · {draft.instrument} {draft.direction.toUpperCase()} · {draft.contracts} ct
        </AppText>
      </View>

      <Card raised>
        <View style={styles.metrics}>
          <Metric label="Risk" value={money(risk.riskDollars)} />
          <Metric label="Reward" value={money(risk.rewardDollars)} />
          <Metric label="R:R" value={rr(risk.rr)} />
        </View>
      </Card>

      {evaluation.violations.length > 0 ? (
        <Card tone="danger">
          <View style={styles.head}>
            <Ionicons name="close-circle" size={18} color={colors.danger} />
            <AppText variant="label" tone="danger">
              {evaluation.grade === 'NO_TRADE' ? 'No trade' : 'Rule violation'}
            </AppText>
          </View>
          {evaluation.violations.map((v) => (
            <AppText key={v} variant="body" style={styles.line}>
              {v}
            </AppText>
          ))}
        </Card>
      ) : null}

      <Card>
        <AppText variant="label" style={{ marginBottom: spacing.md }}>
          Checks
        </AppText>
        <RuleChecklist rows={rows} />
      </Card>

      {evaluation.cautions.length > 0 ? (
        <Card tone="warning">
          <View style={styles.head}>
            <Ionicons name="warning" size={18} color={colors.warning} />
            <AppText variant="label" tone="warning">
              Caution
            </AppText>
          </View>
          {evaluation.cautions.map((c) => (
            <AppText key={c} variant="body" style={styles.line}>
              {c}
            </AppText>
          ))}
        </Card>
      ) : null}

      {aiAllowed ? (
        <Card>
          <View style={styles.head}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <AppText variant="label" tone="accent">
              {analysis?.source === 'ai' ? 'AI review' : 'Guard review'}
            </AppText>
          </View>
          {analysis ? (
            <>
              <AppText variant="body" style={styles.line}>
                {analysis.summary}
              </AppText>
              {analysis.reminders.map((r) => (
                <AppText key={r} variant="caption" style={{ marginTop: spacing.xs }}>
                  • {r}
                </AppText>
              ))}
            </>
          ) : (
            <AppText variant="caption" style={styles.line}>
              Reviewing against your rules…
            </AppText>
          )}
          <AppText variant="caption" tone="tertiary" style={{ marginTop: spacing.md, fontSize: 11 }}>
            {AI_DISCLAIMER}
          </AppText>
        </Card>
      ) : (
        <Card onPress={() => router.push('/paywall')}>
          <AppText variant="label" tone="accent">
            AI Trade Checker · Pro
          </AppText>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            Get a written review of every setup against your plan.
          </AppText>
        </Card>
      )}

      {cooldownBlocked ? (
        <AppText variant="caption" tone="warning" align="center">
          Cooldown overrides are disabled in your rules. New trades unlock when the cooldown ends.
        </AppText>
      ) : null}

      <ConfirmationSheet
        visible={sheet === 'caution'}
        title="Caution setup"
        message={`This setup matches ${evaluation.matchPct}% of your ${strategy.name} checklist. Your plan says to wait for full confirmation. Entering will be recorded in your Discipline Score.`}
        confirmLabel="Enter anyway"
        cancelLabel="Wait for confirmation"
        onConfirm={enterTrade}
        onCancel={() => setSheet('none')}
      />

      <WarningSheet
        visible={sheet === 'violation'}
        title={evaluation.grade === 'NO_TRADE' ? 'No trade recommended' : 'Rule violation'}
        tone="danger"
        lines={evaluation.violations.length ? evaluation.violations : violationEvents.map((v) => v.detail)}
        question="Prop Guard recommends not taking this trade. Continue anyway?"
        overrideLabel={canEnter ? 'Override and enter' : undefined}
        onOverride={enterTrade}
        onCancel={() => setSheet('none')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  metrics: { flexDirection: 'row', gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { marginTop: spacing.sm },
});
