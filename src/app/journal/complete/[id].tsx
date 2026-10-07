import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GRADE_UI, pnlTone } from '@/components/domain/guardUi';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  ChoiceGrid,
  ConfirmationSheet,
  DetailTable,
  EmptyState,
  FieldRow,
  Input,
  Metric,
  Screen,
  SelectField,
  StatusBadge,
  Stepper,
  TabSwitch,
  ToggleRow,
  YesNo,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ChartImport } from '@/features/analyze/ChartImport';
import { useStrategy } from '@/hooks/useAppData';
import { completePendingTrade, OUTCOME_LABEL, tradeOutcome, type TradeResultInput } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Emotion, PendingTrade } from '@/types/domain';
import { dayKey } from '@/utils/dates';
import { longDate, money, parseNum, points, price, rMultiple, rr, time } from '@/utils/format';
import { uuid } from '@/utils/id';

type ResultKind = TradeResultInput['kind'];

const EMOTIONS: { value: Emotion; label: string }[] = [
  { value: 'calm', label: 'Calm' },
  { value: 'confident', label: 'Confident' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'frustrated', label: 'Frustrated' },
  { value: 'fomo', label: 'FOMO' },
  { value: 'tired', label: 'Tired' },
];

/** Complete a pending trade: add the result (or a screenshot) and the full journal entry is built automatically. */
export default function CompletePendingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pending = useAppStore((s) => s.pendingTrades.find((p) => p.id === id) ?? null);

  if (!pending || pending.status !== 'pending') {
    return (
      <Screen header={<AppHeader title="Add result" back />}>
        {pending?.status === 'completed' && pending.tradeId ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="Already journaled"
            message="This trade's journal entry has been created."
            actionLabel="Open journal entry"
            onAction={() => router.replace({ pathname: '/journal/[id]', params: { id: pending.tradeId! } })}
          />
        ) : pending?.status === 'entered' && pending.tradeId ? (
          <EmptyState
            icon="pulse-outline"
            title="Trade is live"
            message="This trade is open in the live monitor. Closing it there completes the journal entry."
            actionLabel="Open live monitor"
            onAction={() => router.replace({ pathname: '/session/live', params: { id: pending.tradeId! } })}
          />
        ) : (
          <EmptyState icon="document-outline" title="Nothing pending" message="This pending trade was completed or removed." />
        )}
      </Screen>
    );
  }
  return <CompleteForm pending={pending} />;
}

function CompleteForm({ pending: p }: { pending: PendingTrade }) {
  const strategy = useStrategy(p.strategyId);
  const completePending = useAppStore((s) => s.completePending);
  const setPendingStatus = useAppStore((s) => s.setPendingStatus);
  const activeAccountId = useAppStore((s) => s.activeAccountId);

  const [mode, setMode] = useState<'result' | 'screenshot'>('result');
  const [kind, setKind] = useState<ResultKind | null>(null);
  const [exit, setExit] = useState('');
  const [pnlInput, setPnlInput] = useState('');
  const [entryFill, setEntryFill] = useState(String(p.entry));
  const [contracts, setContracts] = useState(p.contracts);
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [emotion, setEmotion] = useState<Emotion | null>(null);
  const [notes, setNotes] = useState(p.notes);
  const [shot, setShot] = useState<string | null | false>(false);
  const [confirmed, setConfirmed] = useState(true);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  const result: TradeResultInput | null =
    kind === 'exit'
      ? { kind, exitPrice: parseNum(exit) ?? NaN }
      : kind === 'pnl'
        ? { kind, pnl: parseNum(pnlInput) ?? NaN }
        : kind
          ? { kind }
          : null;

  const draft = result
    ? completePendingTrade(p, {
        tradeId: 'preview',
        result,
        entryFill: parseNum(entryFill),
        contracts,
        closedAt: p.createdAt,
        followedPlan: followed,
      })
    : null;
  const preview = draft && !('error' in draft) ? draft : null;
  // Don't nag about an empty field the trader hasn't filled in yet.
  const untouched = (kind === 'exit' && !exit) || (kind === 'pnl' && !pnlInput);
  const error = draft && 'error' in draft && !untouched ? draft.error : null;
  const outcome = tradeOutcome(preview?.pnl);
  const canSave = preview != null && confirmed;

  const save = () => {
    if (!result) return;
    const st = useAppStore.getState();
    const today = dayKey(new Date()) === dayKey(p.createdAt);
    const session = today && p.accountId === activeAccountId ? st.ensureSession() : null;
    const trade = completePendingTrade(p, {
      tradeId: uuid(),
      result,
      entryFill: parseNum(entryFill),
      contracts,
      closedAt: new Date().toISOString(),
      sessionId: session?.id ?? null,
      notes,
      emotion,
      followedPlan: followed,
      screenshotUri: shot || null,
    });
    if ('error' in trade) return;
    completePending(p.id, trade);
    router.replace({ pathname: '/journal/[id]', params: { id: trade.id } });
  };

  const grade = p.setupGrade ? GRADE_UI[p.setupGrade] : null;
  const kinds: { value: ResultKind; label: string; sub?: string }[] = [
    ...(p.target != null ? [{ value: 'target' as const, label: 'Hit target', sub: price(p.target, p.instrument) }] : []),
    { value: 'stop', label: 'Hit stop', sub: price(p.stop, p.instrument) },
    { value: 'breakeven', label: 'Breakeven', sub: 'Exit at entry' },
    { value: 'exit', label: 'Exit price', sub: 'Closed elsewhere' },
    { value: 'pnl', label: 'Dollar P&L', sub: 'From your platform' },
  ];

  return (
    <Screen
      header={<AppHeader title="Add result" back />}
      footer={
        mode === 'result' ? (
          <>
            <Button label="Create journal entry" icon="checkmark" disabled={!canSave} onPress={save} />
            <Button label="I didn't take this trade" variant="ghost" onPress={() => setConfirmDismiss(true)} />
          </>
        ) : undefined
      }>
      <View style={styles.hero}>
        <View style={styles.row}>
          <AppText variant="title">
            {p.instrument} {p.direction.toUpperCase()}
          </AppText>
          <StatusBadge label="Pending result" tone="warning" icon="time-outline" size="sm" />
        </View>
        <AppText variant="caption">
          Checked {longDate(p.createdAt)} · {time(p.createdAt)} · {p.origin === 'calculator' ? 'Risk Calculator' : p.origin === 'setup_check' ? 'AI Setup Check · QUALIFIED' : 'Trade check'}
        </AppText>
      </View>

      <Card>
        <DetailTable
          title="Your plan"
          rows={[
            { label: 'Entry', value: price(p.entry, p.instrument) },
            { label: 'Stop', value: price(p.stop, p.instrument) },
            { label: 'Target', value: price(p.target, p.instrument) },
            { label: 'Contracts', value: String(p.contracts) },
            { label: 'Account size', value: money(p.accountBalance) },
            { label: 'Dollar risk', value: money(p.riskDollars) },
            { label: 'Dollar reward', value: money(p.rewardDollars), tone: p.rewardDollars ? 'positive' : 'primary' },
            { label: 'R:R', value: rr(p.rr) },
            { label: 'Strategy', value: strategy?.name ?? '—' },
            ...(grade ? [{ label: 'Setup check', value: `${grade.label} · ${p.setupScore ?? '—'}%`, tone: grade.tone }] : []),
            ...(p.checklist.length ? [{ label: 'Checklist', value: `${p.checklist.filter((c) => c.value).length}/${p.checklist.length} confirmed` }] : []),
          ]}
        />
      </Card>

      <TabSwitch
        options={[
          { value: 'result', label: 'Enter Result' },
          { value: 'screenshot', label: 'Upload Screenshot' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'screenshot' ? (
        <ChartImport
          cta="Use exit from screenshot"
          onUse={(v) => {
            const mismatches = [v.instrument !== p.instrument ? `instrument ${v.instrument}` : null, v.direction !== p.direction ? v.direction : null].filter(Boolean);
            setMismatch(mismatches.length ? `The screenshot shows ${mismatches.join(' / ')}, but this plan is ${p.instrument} ${p.direction}. Check it's the right trade.` : null);
            if (v.entry) setEntryFill(v.entry);
            if (v.target) {
              setKind('exit');
              setExit(v.target);
            }
            setShot(v.imageUri);
            setConfirmed(false);
            setMode('result');
          }}
        />
      ) : (
        <>
          {shot !== false ? (
            <Card tone="accent">
              <StatusBadge label="Read from screenshot" tone="accent" icon="scan" size="sm" />
              <AppText variant="caption" style={{ marginTop: spacing.sm }}>
                The exit was read from the chart&apos;s exit/target level. Edit anything that doesn&apos;t match your fill.
              </AppText>
              {mismatch ? (
                <AppText variant="caption" tone="warning" style={{ marginTop: spacing.xs }}>
                  {mismatch}
                </AppText>
              ) : null}
              <ToggleRow label="These values match my fill" value={confirmed} onChange={setConfirmed} />
            </Card>
          ) : null}

          <Card>
            <ChoiceGrid label="How did it end?" options={kinds} value={kind} onChange={setKind} columns={3} />
            {kind === 'exit' ? <FieldRow label="Exit price" value={exit} onChangeText={setExit} placeholder="Price" /> : null}
            {kind === 'pnl' ? <FieldRow label="P&L" prefix="$" value={pnlInput} onChangeText={setPnlInput} placeholder="-120 or 250" /> : null}
            <FieldRow label="Entry fill" value={entryFill} onChangeText={setEntryFill} placeholder="Price" />
            <FieldRow label="Contracts" control={<Stepper label="Contracts" value={contracts} onChange={setContracts} />} />
            {error ? (
              <AppText variant="caption" tone="danger" style={{ marginTop: spacing.sm }}>
                {error}
              </AppText>
            ) : null}
          </Card>

          {preview ? (
            <Card raised>
              <View style={styles.row}>
                <AppText variant="label">Result</AppText>
                {outcome ? (
                  <StatusBadge
                    label={OUTCOME_LABEL[outcome]}
                    tone={outcome === 'win' ? 'positive' : outcome === 'loss' ? 'danger' : 'neutral'}
                    icon={outcome === 'win' ? 'trending-up' : outcome === 'loss' ? 'trending-down' : 'remove'}
                    size="sm"
                  />
                ) : null}
              </View>
              <View style={[styles.metrics, { marginTop: spacing.md }]}>
                <Metric label="P&L" value={money(preview.pnl, { sign: true })} tone={pnlTone(preview.pnl)} />
                <Metric label="Points" value={points(preview.points, true)} />
                <Metric label="R" value={rMultiple(preview.realizedR)} />
              </View>
              <AppText variant="caption" style={{ marginTop: spacing.md }}>
                Exit {price(preview.exitPrice, p.instrument)} · risk {money(preview.riskDollars)} · planned {rr(preview.rMultiple)}
              </AppText>
            </Card>
          ) : null}

          <Card>
            <YesNo label="Did you follow your plan?" value={followed} onChange={setFollowed} />
            <FieldRow label="Emotion" control={<SelectField label="Emotion" value={emotion} options={EMOTIONS} onChange={setEmotion} />} />
          </Card>
          <Input label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="What happened? Anything to repeat or avoid?" />

          <View style={styles.auto}>
            <Ionicons name="sparkles-outline" size={14} color={colors.textSecondary} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              Instrument, prices, size, account, risk, reward, R:R, strategy, time and your pre-trade checklist are filled in automatically.
            </AppText>
          </View>
        </>
      )}

      <ConfirmationSheet
        visible={confirmDismiss}
        title="Remove pending trade?"
        message="Use this when you checked a setup but didn't take it. Nothing is added to your journal or stats."
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirmDismiss(false)}
        onConfirm={() => {
          setConfirmDismiss(false);
          setPendingStatus(p.id, 'dismissed');
          router.back();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  metrics: { flexDirection: 'row', gap: spacing.md },
  auto: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  flex: { flex: 1 },
});
