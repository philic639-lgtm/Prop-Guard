import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TradeCard } from '@/components/domain/TradeCard';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  ChoiceGrid,
  FieldRow,
  Input,
  Screen,
  SegmentedControl,
  SelectField,
  StatusBadge,
  Stepper,
  TabSwitch,
  ToggleRow,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ChartImport } from '@/features/analyze/ChartImport';
import { useActiveAccount } from '@/hooks/useAppData';
import { instrumentOptions, pointsToDollars, realizedPnl, realizedR } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, Emotion, InstrumentSymbol, Trade } from '@/types/domain';
import { addDays } from '@/utils/dates';
import { money, parseNum, points } from '@/utils/format';
import { uuid } from '@/utils/id';

const EMOTIONS: { value: Emotion; label: string }[] = [
  { value: 'calm', label: 'Calm' },
  { value: 'confident', label: 'Confident' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'frustrated', label: 'Frustrated' },
  { value: 'fomo', label: 'FOMO' },
  { value: 'tired', label: 'Tired' },
];

/** Journal a completed trade — manually or from a screenshot (values confirmed by the trader). */
export default function JournalNew() {
  const account = useActiveAccount();
  const strategies = useAppStore((s) => s.strategies);
  const activeStrategyId = useAppStore((s) => s.activeStrategyId);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const markets = useAppStore((s) => s.preferences.markets);
  const addJournalTrade = useAppStore((s) => s.addJournalTrade);

  const [mode, setMode] = useState<'screenshot' | 'manual'>('manual');
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction>('long');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [stop, setStop] = useState('');
  const [contracts, setContracts] = useState(1);
  const [strategyId, setStrategyId] = useState<string>(activeStrategyId ?? 'none');
  const [emotion, setEmotion] = useState<Emotion>('calm');
  const [followed, setFollowed] = useState<'yes' | 'no' | null>(null);
  const [notes, setNotes] = useState('');
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [fromShot, setFromShot] = useState<string | null | false>(false);
  const [confirmed, setConfirmed] = useState(true);
  const [saved, setSaved] = useState<Trade | null>(null);

  const e = parseNum(entry);
  const x = parseNum(exit);
  const st = parseNum(stop);
  const pnl = e != null && x != null ? realizedPnl(instrument, direction, e, x, contracts) : null;
  const pts = e != null && x != null ? (direction === 'long' ? x - e : e - x) : null;
  const stopValid = st == null || (direction === 'long' ? st < (e ?? Infinity) : st > (e ?? -Infinity));
  const canSave = !!account && e != null && x != null && e > 0 && x > 0 && followed != null && stopValid && confirmed;

  const save = () => {
    if (!account || e == null || x == null || pnl == null) return;
    const when = day === 'today' ? new Date() : addDays(new Date(), -1);
    const closedAt = when.toISOString();
    const openedAt = new Date(when.getTime() - 15 * 60_000).toISOString();
    const riskDollars = st != null ? pointsToDollars(instrument, Math.abs(e - st), contracts) : 0;
    const trade: Trade = {
      id: uuid(),
      accountId: account.id,
      strategyId: strategyId === 'none' ? null : strategyId,
      sessionId: null,
      instrument,
      direction,
      entryPrice: e,
      stopPrice: st ?? e,
      originalStopPrice: st ?? e,
      targetPrice: null,
      exitPrice: x,
      contracts,
      riskDollars,
      rewardDollars: null,
      rMultiple: null,
      realizedR: riskDollars > 0 ? realizedR(pnl, riskDollars) : null,
      pnl,
      points: pts != null ? Math.round(pts * 100) / 100 : null,
      status: 'closed',
      openedAt,
      closedAt,
      bias: null,
      checklist: [],
      rulesFollowed: followed === 'yes' ? ['followed_plan'] : [],
      rulesViolated: followed === 'no' ? ['followed_plan'] : [],
      setupScore: null,
      setupGrade: null,
      disciplineScore: followed === 'no' ? 75 : 100,
      notes: notes.trim(),
      aiSummary: null,
      emotion,
      setupRating: null,
      screenshotUri: fromShot || null,
      source: fromShot === false ? 'manual' : 'screenshot',
      journaled: true,
      mae: null,
      mfe: null,
      followedPlan: followed === 'yes',
    };
    addJournalTrade(trade);
    setSaved(trade);
  };

  if (saved) {
    const strategyName = strategies.find((s) => s.id === saved.strategyId)?.name ?? null;
    return (
      <Screen
        header={<AppHeader title="Journal" />}
        footer={
          <>
            <Button label="View Journal" onPress={() => router.dismissTo('/journal')} />
            <Button
              label="Add Another Trade"
              variant="secondary"
              onPress={() => {
                setSaved(null);
                setEntry('');
                setExit('');
                setStop('');
                setNotes('');
                setFollowed(null);
                setFromShot(false);
              }}
            />
          </>
        }>
        <View style={styles.done}>
          <View style={styles.doneIcon}>
            <Ionicons name="checkmark" size={44} color={colors.positive} />
          </View>
          <AppText variant="title" align="center">
            Trade journaled
          </AppText>
          <AppText variant="body" tone="secondary" align="center">
            The trade is added to your journal and your stats update automatically.
          </AppText>
        </View>
        <TradeCard trade={saved} strategyName={strategyName} onPress={() => router.replace({ pathname: '/journal/[id]', params: { id: saved.id } })} />
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader title="Journal trade" back />} footer={mode === 'manual' ? <Button label="Save Entry" icon="checkmark" disabled={!canSave} onPress={save} /> : undefined}>
      <TabSwitch
        options={[
          { value: 'screenshot', label: 'Upload Screenshot' },
          { value: 'manual', label: 'Enter Manually' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'screenshot' ? (
        <>
          <Card>
            <AppText variant="label">AI will extract</AppText>
            {['Instrument & direction', 'Entry / exit', 'Stop (if visible)', 'Key levels'].map((t) => (
              <View key={t} style={styles.extract}>
                <Ionicons name="checkmark-circle" size={16} color={colors.positive} />
                <AppText variant="body">{t}</AppText>
              </View>
            ))}
          </Card>
          <ChartImport
            cta="Review extracted trade"
            onUse={(v) => {
              setInstrument(v.instrument);
              setDirection(v.direction);
              setEntry(v.entry);
              setStop(v.stop);
              setExit(v.target);
              setFromShot(v.imageUri);
              setConfirmed(false);
              setMode('manual');
            }}
          />
        </>
      ) : (
        <>
          {fromShot !== false ? (
            <Card tone="accent">
              <StatusBadge label="Extracted from screenshot" tone="accent" icon="scan" size="sm" />
              <AppText variant="caption" style={{ marginTop: spacing.sm }}>
                Exit was read from the chart&apos;s target/exit level. Edit anything that doesn&apos;t match your fill.
              </AppText>
              <ToggleRow label="These values match my fill" value={confirmed} onChange={setConfirmed} />
            </Card>
          ) : null}
          <Card>
            <FieldRow
              label="Instrument"
              control={<SelectField label="Instrument" value={instrument} options={instrumentOptions(markets)} onChange={setInstrument} />}
            />
            <FieldRow
              label="Direction"
              control={
                <SegmentedControl
                  options={[
                    { value: 'long', label: 'Long', tone: 'positive' },
                    { value: 'short', label: 'Short', tone: 'danger' },
                  ]}
                  value={direction}
                  onChange={setDirection}
                />
              }
            />
            <FieldRow label="Entry" value={entry} onChangeText={setEntry} placeholder="Price" />
            <FieldRow label="Exit" value={exit} onChangeText={setExit} placeholder="Price" />
            <FieldRow label="Stop (optional)" value={stop} onChangeText={setStop} placeholder="For R multiple" error={stopValid ? null : 'Stop is on the wrong side of entry'} />
            <FieldRow label="Contracts" control={<Stepper label="Contracts" value={contracts} onChange={setContracts} />} />
            <View style={styles.pnlRow}>
              <AppText variant="body">P&L</AppText>
              <AppText variant="number" tone={pnl == null ? 'secondary' : pnl >= 0 ? 'positive' : 'danger'}>
                {pnl == null ? '—' : `${money(pnl, { sign: true })} · ${points(pts, true)}`}
              </AppText>
            </View>
          </Card>

          <Card>
            <FieldRow
              label="Setup Type"
              control={
                <SelectField
                  label="Setup type"
                  value={strategyId}
                  options={[...strategies.map((s) => ({ value: s.id, label: s.name })), { value: 'none', label: 'No strategy' }]}
                  onChange={setStrategyId}
                />
              }
            />
            <FieldRow label="Emotion" control={<SelectField label="Emotion" value={emotion} options={EMOTIONS} onChange={setEmotion} />} />
            <FieldRow
              label="Followed Plan?"
              control={
                <SegmentedControl
                  options={[
                    { value: 'yes', label: 'Yes', tone: 'positive' },
                    { value: 'no', label: 'No', tone: 'danger' },
                  ]}
                  value={followed}
                  onChange={setFollowed}
                />
              }
            />
            <ChoiceGrid
              label="When"
              columns={2}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'yesterday', label: 'Yesterday' },
              ]}
              value={day}
              onChange={setDay}
            />
          </Card>
          <Input label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Clean breakout after 9:50. Good execution." />
          {followed == null ? (
            <AppText variant="caption" tone="tertiary" align="center">
              Answer “Followed plan?” to save — it feeds your Discipline Score.
            </AppText>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  extract: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  pnlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50 },
  done: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  doneIcon: { width: 92, height: 92, borderRadius: 46, borderWidth: 3, borderColor: colors.positive, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.positiveMuted },
});
