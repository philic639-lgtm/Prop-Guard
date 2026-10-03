import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { GRADE_UI, pnlTone } from '@/components/domain/guardUi';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  Chip,
  ConfirmationSheet,
  EmptyState,
  Input,
  Metric,
  RuleChecklist,
  Screen,
  SectionHeader,
  StatusBadge,
  VerdictBanner,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useStrategy, useTrade } from '@/hooks/useAppData';
import { OUTCOME_LABEL, tradeConditions, tradeOutcome } from '@/lib/engines';
import { pickScreenshot } from '@/services/screenshotService';
import { useAppStore } from '@/store/useAppStore';
import type { Emotion, Trade } from '@/types/domain';
import { longDate, money, points, price, rMultiple, rr, time } from '@/utils/format';

const EMOTIONS: { value: Emotion; label: string }[] = [
  { value: 'calm', label: 'Calm' },
  { value: 'confident', label: 'Confident' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'frustrated', label: 'Frustrated' },
  { value: 'fomo', label: 'FOMO' },
  { value: 'tired', label: 'Tired' },
];

const RULE_LABELS: Record<string, string> = {
  risk_per_trade: 'Risk within per-trade limit',
  risk_daily: 'Risk within daily limit',
  min_rr: 'Minimum R:R met',
  target_set: 'Target defined',
  max_contracts: 'Within max contracts',
  cooldown: 'Cooldown respected',
  strategy_max_trades: 'Strategy trade limit',
  bias_aligned: 'Bias aligned',
  entry_window: 'Inside entry window',
  stop_widened: 'Stop not widened',
};

export default function TradeDetail() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const trade = useTrade(id);
  const strategy = useStrategy(trade?.strategyId);
  const events = useAppStore((s) => s.events);
  const journalTrade = useAppStore((s) => s.journalTrade);
  const updateTrade = useAppStore((s) => s.updateTrade);
  const deleteTrade = useAppStore((s) => s.deleteTrade);

  const [editing, setEditing] = useState(edit === '1');
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [emotion, setEmotion] = useState<Emotion | null>(trade?.emotion ?? null);
  const [rating, setRating] = useState<number | null>(trade?.setupRating ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tradeEvents = useMemo(() => events.filter((e) => e.tradeId === id && e.type !== 'JOURNAL_COMPLETED' && e.type !== 'RULE_FOLLOWED'), [events, id]);

  if (!trade) {
    return (
      <Screen header={<AppHeader title="Trade" back />}>
        <EmptyState icon="document-outline" title="Trade not found" message="It may have been deleted." />
      </Screen>
    );
  }

  const label = (rid: string) => {
    if (rid.startsWith('check_')) {
      const itemId = rid.slice(6);
      return trade.checklist.find((c) => c.itemId === itemId)?.label ?? strategy?.checklist.find((c) => c.id === itemId)?.label ?? 'Checklist item';
    }
    return RULE_LABELS[rid] ?? rid;
  };

  const ruleRows = [
    ...trade.rulesFollowed.map((r) => ({ id: `f_${r}`, label: label(r), state: 'pass' as const })),
    ...trade.rulesViolated.map((r) => ({ id: `v_${r}`, label: label(r), state: 'fail' as const })),
  ];
  const grade = trade.setupGrade ? GRADE_UI[trade.setupGrade] : null;
  const cond = tradeConditions(trade);
  const followed = trade.followedPlan ?? trade.rulesViolated.filter((r) => r !== 'entry_window').length === 0;
  const outcome = trade.status === 'closed' ? tradeOutcome(trade.pnl) : null;
  const aiNotes = trade.aiSummary ?? tradeNotes(trade, cond, followed, strategy?.name ?? null);

  const save = () => {
    journalTrade(trade.id, { notes: notes.trim(), emotion, setupRating: rating });
    setEditing(false);
  };

  const attach = async () => {
    const r = await pickScreenshot('library');
    if (r.status === 'ok') updateTrade(trade.id, { screenshotUri: r.image.uri });
  };

  return (
    <Screen
      header={
        <AppHeader
          title="Trade detail"
          back
          right={!editing ? <Button label="Edit" size="md" variant="ghost" onPress={() => setEditing(true)} /> : undefined}
        />
      }
      footer={editing ? <Button label="Save journal" icon="checkmark" onPress={save} /> : undefined}>
      <View style={styles.hero}>
        <View style={styles.row}>
          <AppText variant="title">
            {trade.instrument} {trade.direction.toUpperCase()}
          </AppText>
          {trade.journaled ? <StatusBadge label="Journaled" tone="positive" icon="checkmark" size="sm" /> : <StatusBadge label="Needs notes" tone="accent" size="sm" />}
        </View>
        <AppText variant="caption">
          {longDate(trade.openedAt)} · {time(trade.openedAt)}
          {trade.closedAt ? ` – ${time(trade.closedAt)}` : ''}
        </AppText>
        <AppText variant="hero" tone={pnlTone(trade.pnl)} style={{ marginTop: spacing.sm }}>
          {trade.status === 'open' ? 'Open' : money(trade.pnl, { sign: true })}
        </AppText>
        <AppText variant="bodyStrong" tone="secondary">
          {points(trade.points, true)} · {rMultiple(trade.realizedR)}
        </AppText>
        {outcome || SOURCE_LABEL[trade.source] ? (
          <View style={[styles.badges, { marginTop: spacing.sm }]}>
            {outcome ? (
              <StatusBadge
                label={OUTCOME_LABEL[outcome]}
                tone={outcome === 'win' ? 'positive' : outcome === 'loss' ? 'danger' : 'neutral'}
                icon={outcome === 'win' ? 'trending-up' : outcome === 'loss' ? 'trending-down' : 'remove'}
                size="sm"
              />
            ) : null}
            {SOURCE_LABEL[trade.source] ? <StatusBadge label={SOURCE_LABEL[trade.source]!} tone="accent" icon={trade.source === 'broker' ? 'link' : 'sparkles'} size="sm" /> : null}
          </View>
        ) : null}
      </View>

      {trade.status === 'closed' ? (
        <VerdictBanner
          tone={followed ? 'positive' : 'danger'}
          title={followed ? 'Strategy followed' : 'Plan not followed'}
          subtitle={cond.total > 0 ? `${cond.met}/${cond.total} conditions matched at entry` : followed ? 'You reported following your plan' : 'You reported breaking your plan'}
          badge={trade.rMultiple != null ? `1:${trade.rMultiple} R:R` : undefined}
        />
      ) : null}

      <Card>
        <View style={styles.row}>
          <Ionicons name="sparkles" size={16} color={colors.accentBright} />
          <AppText variant="label" tone="accent" style={{ marginRight: 'auto' }}>
            AI notes
          </AppText>
        </View>
        <AppText variant="body" style={{ marginTop: spacing.sm }}>
          {aiNotes}
        </AppText>
      </Card>

      <Card>
        <View style={styles.grid}>
          <Metric label="Entry" value={price(trade.entryPrice, trade.instrument)} compact />
          <Metric label="Exit" value={price(trade.exitPrice, trade.instrument)} compact />
          <Metric label="Contracts" value={String(trade.contracts)} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Stop" value={price(trade.stopPrice, trade.instrument)} sub={trade.stopPrice !== trade.originalStopPrice ? `orig ${price(trade.originalStopPrice, trade.instrument)}` : undefined} compact />
          <Metric label="Target" value={price(trade.targetPrice, trade.instrument)} compact />
          <Metric label="Planned" value={rr(trade.rMultiple)} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Risk" value={money(trade.riskDollars)} compact />
          <Metric label="Strategy" value={strategy?.name ?? '—'} compact />
          <Metric label="Discipline" value={`${trade.disciplineScore ?? 100}%`} tone={(trade.disciplineScore ?? 100) >= 100 ? 'positive' : 'warning'} compact />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Reward" value={money(trade.rewardDollars)} compact />
          <Metric label="Account" value={money(trade.accountBalance)} compact />
          <Metric label="Result" value={outcome ? OUTCOME_LABEL[outcome] : '—'} tone={outcome === 'win' ? 'positive' : outcome === 'loss' ? 'danger' : undefined} compact />
        </View>
      </Card>

      {grade ? (
        <Card>
          <View style={styles.row}>
            <AppText variant="label">Setup check</AppText>
            <StatusBadge label={`${grade.label} · ${trade.setupScore ?? '—'}%`} tone={grade.tone} icon={grade.icon} size="sm" />
          </View>
          {trade.aiSummary ? (
            <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
              {trade.aiSummary}
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {trade.checklist.length > 0 ? (
        <>
          <SectionHeader title="Pre-trade checklist" />
          <Card>
            <RuleChecklist rows={trade.checklist.map((c) => ({ id: c.itemId, label: c.label, state: c.value ? 'pass' : 'fail' }))} />
          </Card>
        </>
      ) : null}

      {ruleRows.length > 0 ? (
        <>
          <SectionHeader title="Rules" />
          <Card>
            <RuleChecklist rows={ruleRows} />
          </Card>
        </>
      ) : null}

      {tradeEvents.length > 0 ? (
        <Card tone="warning">
          <AppText variant="label" tone="warning">
            Discipline events
          </AppText>
          {tradeEvents.map((e) => (
            <AppText key={e.id} variant="body" style={{ marginTop: spacing.sm }}>
              • {e.detail}
            </AppText>
          ))}
        </Card>
      ) : null}

      <SectionHeader title="Screenshot" />
      {trade.screenshotUri ? (
        <Image source={{ uri: trade.screenshotUri }} style={styles.shot} contentFit="contain" accessibilityLabel="Trade screenshot" />
      ) : (
        <Button label="Attach screenshot" variant="secondary" icon="image-outline" size="md" onPress={() => void attach()} />
      )}

      <SectionHeader title="Journal" />
      {editing ? (
        <>
          <Input label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="What did you see? Did you follow the plan?" />
          <View style={{ gap: spacing.sm }}>
            <AppText variant="label">Emotion</AppText>
            <View style={styles.chips}>
              {EMOTIONS.map((e) => (
                <Chip key={e.value} label={e.label} selected={emotion === e.value} onPress={() => setEmotion(emotion === e.value ? null : e.value)} />
              ))}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="label">Setup rating</AppText>
            <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Setup rating ${rating ?? 0} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} hitSlop={6} onPress={() => setRating(n)}>
                  <Ionicons name={rating != null && n <= rating ? 'star' : 'star-outline'} size={30} color={rating != null && n <= rating ? colors.warning : colors.textTertiary} />
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : (
        <Card>
          {trade.notes ? <AppText variant="body">{trade.notes}</AppText> : <AppText variant="caption">No notes yet. Tap Edit to add them while the trade is fresh.</AppText>}
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <AppText variant="caption">Emotion: {EMOTIONS.find((e) => e.value === trade.emotion)?.label ?? '—'}</AppText>
            <AppText variant="caption">Rating: {trade.setupRating ? '★'.repeat(trade.setupRating) : '—'}</AppText>
          </View>
        </Card>
      )}

      {!editing ? <Button label="Delete trade" variant="ghost" onPress={() => setConfirmDelete(true)} /> : null}
      <ConfirmationSheet
        visible={confirmDelete}
        title="Delete trade"
        message="This removes the trade and its discipline events. Account balance is not changed."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          deleteTrade(trade.id);
          router.back();
        }}
      />
    </Screen>
  );
}

const SOURCE_LABEL: Partial<Record<Trade['source'], string>> = {
  auto: 'Auto-journaled',
  broker: 'Broker import',
};

const styles = StyleSheet.create({
  hero: { gap: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  grid: { flexDirection: 'row', gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stars: { flexDirection: 'row', gap: spacing.md },
  shot: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
});

/** Deterministic, specific trade notes (used when no AI summary was stored). */
function tradeNotes(t: Trade, cond: { met: number; total: number }, followed: boolean, strategyName: string | null): string {
  const parts: string[] = [];
  if (cond.total > 0) parts.push(`Entered ${strategyName ?? 'the trade'} with ${cond.met}/${cond.total} conditions confirmed.`);
  if (t.riskDollars > 0) parts.push(`Planned risk ${money(t.riskDollars)}${t.rMultiple ? ` for a 1:${t.rMultiple} target` : ''}.`);
  if (t.stopPrice !== t.originalStopPrice) parts.push('The stop was moved after entry.');
  if (t.exitPrice != null && t.targetPrice != null && t.exitPrice === t.targetPrice) parts.push('Exited at the planned target.');
  else if (t.exitPrice != null && t.exitPrice === t.stopPrice) parts.push('Stopped out at the planned stop — a disciplined loss.');
  else if (t.realizedR != null) parts.push(`Closed at ${t.realizedR > 0 ? '+' : ''}${t.realizedR}R.`);
  parts.push(followed ? 'Plan followed.' : 'Plan not followed — review what pulled you off your rules.');
  return parts.join(' ');
}
