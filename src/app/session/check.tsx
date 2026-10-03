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
  ConfirmationSheet,
  DetailTable,
  LoadingState,
  RuleChecklist,
  Screen,
  VerdictBanner,
  WarningSheet,
  type ChecklistRow,
  type DetailRow,
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
import { GRADE_LABEL, maxContractsForRisk } from '@/lib/engines';
import type { DisciplineCategory, DisciplineEventType, SetupGrade, Trade } from '@/types/domain';
import { uuid } from '@/utils/id';
import { money, price, rr } from '@/utils/format';

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
      notes: draft.notes?.trim() ?? '',
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
    if (draft.planId) store().setPlanStatus(draft.planId, 'executed');

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

  const verdict = verdictFor(evaluation.grade);
  const counted = evaluation.checks.filter((c) => c.severity !== 'context');
  const met = counted.filter((c) => c.passed).length;
  const riskFailed = evaluation.rulesViolated.some((r) => r === 'risk_per_trade' || r === 'risk_daily' || r === 'max_contracts');
  const n = draftNumbers(draft);
  const suggested =
    riskFailed && n.entry != null && n.stop != null
      ? maxContractsForRisk(draft.instrument, n.entry, n.stop, Math.min(rules.maxRiskPerTrade, guard.riskRemaining), guard.maxContracts)
      : null;

  const rows: ChecklistRow[] = evaluation.checks.map((c) => {
    let state: ChecklistRow['state'] = 'pass';
    if (!c.passed) {
      if (c.severity === 'context') state = 'warn';
      else if (c.severity === 'checklist' && (c.detail === 'Not answered' || evaluation.grade === 'CAUTION')) state = 'warn';
      else state = 'fail';
    }
    return { id: c.id, label: c.label, state, detail: c.passed ? c.detail : (c.detail ?? (state === 'warn' ? 'Unclear — not confirmed' : 'Missing')) };
  });

  const details: DetailRow[] = [
    { label: 'Instrument', value: draft.instrument },
    { label: 'Direction', value: draft.direction === 'long' ? 'Long' : 'Short', tone: draft.direction === 'long' ? 'positive' : 'danger' },
    { label: 'Entry', value: price(n.entry) },
    { label: 'Stop', value: `${price(n.stop)}${risk.pointsRisk != null ? ` (${risk.pointsRisk} pts)` : ''}` },
    { label: 'Target', value: `${price(n.target)}${risk.pointsReward != null ? ` (${risk.pointsReward} pts)` : ''}` },
    { label: 'Contracts', value: String(n.contracts ?? '—') },
    { label: 'Dollar risk', value: money(risk.riskDollars), tone: riskFailed ? 'danger' : 'primary' },
    { label: 'Potential reward', value: money(risk.rewardDollars), tone: risk.rewardDollars ? 'positive' : 'primary' },
    { label: 'R:R ratio', value: rr(risk.rr) },
    { label: 'Strategy match', value: `${evaluation.matchPct}% · ${strategy.name}` },
    { label: 'Entry quality', value: GRADE_LABEL[evaluation.grade], tone: verdict.tone },
    { label: 'Conditions met', value: `${met} / ${counted.length}` },
  ];

  return (
    <Screen
      header={<AppHeader title="AI entry analysis" back />}
      footer={
        <>
          <Button label={verdict.cta} variant={verdict.button} icon={verdict.ctaIcon} disabled={!canEnter} onPress={onEnterPress} />
          <View style={styles.footerRow}>
            <Button label="Save Trade Plan" variant="secondary" size="md" icon="bookmark-outline" style={styles.flex} disabled={!risk.valid} onPress={() => router.push('/session/plan')} />
            <Button label="Adjust Trade" variant="secondary" size="md" icon="create-outline" style={styles.flex} onPress={() => router.back()} />
          </View>
        </>
      }>
      <VerdictBanner tone={verdict.tone} title={verdict.title} subtitle={verdict.subtitle} badge={`${met}/${counted.length}`} />

      <Card>
        <AppText variant="label" style={{ marginBottom: spacing.md }}>
          {strategy.name} · conditions
        </AppText>
        <RuleChecklist rows={rows} />
      </Card>

      {evaluation.violations.length > 0 ? (
        <Card tone="danger">
          <View style={styles.head}>
            <Ionicons name="close-circle" size={18} color={colors.danger} />
            <AppText variant="label" tone="danger">
              Violations
            </AppText>
          </View>
          {evaluation.violations.map((v) => (
            <AppText key={v} variant="body" style={styles.line}>
              • {v}
            </AppText>
          ))}
        </Card>
      ) : null}

      {suggested != null ? (
        <Card tone="warning">
          <AppText variant="label" tone="warning">
            Suggested adjustment
          </AppText>
          <AppText variant="body" style={styles.line}>
            {suggested > 0
              ? `Use ${suggested} ${draft.instrument} contract${suggested === 1 ? '' : 's'} or a closer stop to stay within your ${money(Math.min(rules.maxRiskPerTrade, guard.riskRemaining))} risk limit.`
              : `This stop is too wide for even 1 ${draft.instrument} within your ${money(Math.min(rules.maxRiskPerTrade, guard.riskRemaining))} limit. Use a micro contract or a closer stop.`}
          </AppText>
        </Card>
      ) : null}

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
              • {c}
            </AppText>
          ))}
        </Card>
      ) : null}

      <Card>
        <DetailTable title="Trade details" rows={details} />
      </Card>

      {aiAllowed ? (
        <Card>
          <View style={styles.head}>
            <Ionicons name="sparkles" size={16} color={colors.accentBright} />
            <AppText variant="label" tone="accent">
              {analysis?.source === 'ai' ? 'AI analysis' : 'Guard analysis'}
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
              Checking against your rules…
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

      <AppText variant="caption" tone="secondary" align="center">
        {verdict.footnote}
      </AppText>
      {cooldownBlocked ? (
        <AppText variant="caption" tone="warning" align="center">
          Cooldown overrides are disabled in your rules. New trades unlock when the cooldown ends.
        </AppText>
      ) : null}

      <ConfirmationSheet
        visible={sheet === 'caution'}
        title="Proceed with caution"
        message={`This setup meets ${met}/${counted.length} of your ${strategy.name} conditions. Your plan says to wait for full confirmation. Entering will be recorded in your Discipline Score.`}
        confirmLabel="Enter anyway"
        cancelLabel="Wait for confirmation"
        onConfirm={enterTrade}
        onCancel={() => setSheet('none')}
      />

      <WarningSheet
        visible={sheet === 'violation'}
        title={evaluation.grade === 'NO_TRADE' ? 'Not recommended' : 'Rule violation'}
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

type Verdict = {
  tone: 'positive' | 'warning' | 'danger';
  title: string;
  subtitle: string;
  cta: string;
  ctaIcon: 'checkmark-circle' | 'warning' | 'close-circle';
  button: 'success' | 'caution' | 'danger';
  footnote: string;
};

function verdictFor(grade: SetupGrade): Verdict {
  switch (grade) {
    case 'A_PLUS':
    case 'VALID':
      return {
        tone: 'positive',
        title: 'Good Entry',
        subtitle: 'Strategy match — this trade follows your rules',
        cta: 'Trade Approved · Enter Trade',
        ctaIcon: 'checkmark-circle',
        button: 'success',
        footnote: 'You can enter this trade following your plan.',
      };
    case 'CAUTION':
      return {
        tone: 'warning',
        title: 'Caution',
        subtitle: 'Wait — some conditions are not confirmed',
        cta: 'Proceed with Caution',
        ctaIcon: 'warning',
        button: 'caution',
        footnote: 'This trade meets your risk rules but has unconfirmed conditions.',
      };
    case 'RULE_VIOLATION':
      return {
        tone: 'danger',
        title: 'Rule Violation',
        subtitle: 'This trade breaks your rules',
        cta: 'Not Recommended',
        ctaIcon: 'close-circle',
        button: 'danger',
        footnote: 'Adjust the trade or wait for a setup that fits your plan.',
      };
    default:
      return {
        tone: 'danger',
        title: 'No Trade',
        subtitle: 'Your limits or plan say no trade',
        cta: 'Not Recommended',
        ctaIcon: 'close-circle',
        button: 'danger',
        footnote: 'Protecting the account is the priority.',
      };
  }
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { marginTop: spacing.sm },
  flex: { flex: 1 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
});
