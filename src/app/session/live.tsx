import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppHeader,
  AppText,
  Button,
  Card,
  EmptyState,
  Input,
  Metric,
  NumericInput,
  Screen,
  Sheet,
  StatusBadge,
  WarningSheet,
} from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useDailyGuard, useStrategy, useTrade } from '@/hooks/useAppData';
import { isStopWidened, openPnl, stopChangeRiskDelta } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { money, parseNum, price } from '@/utils/format';

type SheetKind = 'none' | 'stop' | 'stopWarning' | 'target' | 'close' | 'note' | 'mark';

export default function LiveTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trade = useTrade(id);
  const strategy = useStrategy(trade?.strategyId);
  const guard = useDailyGuard();
  const rules = useAppStore((s) => s.tradingRules);
  const updateTrade = useAppStore((s) => s.updateTrade);
  const closeTrade = useAppStore((s) => s.closeTrade);
  const recordEvent = useAppStore((s) => s.recordEvent);

  const [sheet, setSheet] = useState<SheetKind>('none');
  const [mark, setMark] = useState<string>('');
  const [newStop, setNewStop] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [exit, setExit] = useState('');
  const [note, setNote] = useState('');

  if (!trade) {
    return (
      <Screen header={<AppHeader title="Live trade" back />}>
        <EmptyState icon="pulse-outline" title="Trade not found" message="This trade may have been closed or removed." actionLabel="Back to session" onAction={() => router.replace('/session')} />
      </Screen>
    );
  }

  if (trade.status !== 'open') {
    return (
      <Screen header={<AppHeader title="Live trade" back />}>
        <EmptyState
          icon="checkmark-done-outline"
          title="Trade closed"
          message={`Closed at ${price(trade.exitPrice)} for ${money(trade.pnl, { sign: true })}.`}
          actionLabel="Open journal entry"
          onAction={() => router.replace({ pathname: '/journal/[id]', params: { id: trade.id } })}
        />
      </Screen>
    );
  }

  const markPrice = parseNum(mark);
  const pnl = markPrice != null ? openPnl(trade.instrument, trade.direction, trade.entryPrice, markPrice, trade.contracts) : null;
  const stopVal = parseNum(newStop);
  const widened = stopVal != null && isStopWidened(trade.direction, trade.stopPrice, stopVal);
  const delta = stopVal != null ? stopChangeRiskDelta(trade.instrument, trade.direction, trade.entryPrice, trade.stopPrice, stopVal, trade.contracts) : 0;
  // Only validate against the market when a current price is known.
  const stopInvalid =
    stopVal != null && markPrice != null && (trade.direction === 'long' ? stopVal >= markPrice : stopVal <= markPrice);

  const applyStop = (override: boolean) => {
    if (stopVal == null) return;
    updateTrade(trade.id, {
      stopPrice: stopVal,
      rulesViolated: override ? [...new Set([...trade.rulesViolated, 'stop_widened'])] : trade.rulesViolated,
      disciplineScore: override ? Math.max(0, (trade.disciplineScore ?? 100) - 25) : trade.disciplineScore,
    });
    if (override) {
      recordEvent({
        type: 'STOP_WIDENED',
        category: 'stop',
        accountId: trade.accountId,
        tradeId: trade.id,
        sessionId: trade.sessionId,
        detail: `Stop moved from ${price(trade.stopPrice)} to ${price(stopVal)} (+${money(delta)} risk).`,
      });
    }
    setNewStop('');
    setSheet('none');
  };

  const onConfirmStop = () => {
    if (stopVal == null) return;
    if (widened) setSheet('stopWarning');
    else applyStop(false);
  };

  const onClose = (exitPrice: number) => {
    const closed = closeTrade(trade.id, exitPrice);
    setSheet('none');
    if (!closed) return;
    if ((closed.pnl ?? 0) < 0) router.replace({ pathname: '/session/loss', params: { id: closed.id } });
    else router.replace({ pathname: '/journal/[id]', params: { id: closed.id, edit: '1' } });
  };

  const exitVal = parseNum(exit);
  const dir = trade.direction.toUpperCase();

  return (
    <Screen header={<AppHeader title="Live trade" back right={<StatusBadge label="Live" tone="accent" />} />}>
      <View style={styles.hero}>
        <AppText variant="title">
          {trade.instrument} {dir}
        </AppText>
        <AppText variant="caption">
          {strategy?.name ?? 'No strategy'} · {trade.contracts} contract{trade.contracts > 1 ? 's' : ''}
        </AppText>
      </View>

      <Card raised onPress={() => setSheet('mark')} accessibilityLabel="Update current price">
        <AppText variant="label">Open P/L</AppText>
        <AppText variant="hero" tone={pnl == null ? 'secondary' : pnl >= 0 ? 'positive' : 'danger'}>
          {pnl == null ? '—' : money(pnl, { sign: true })}
        </AppText>
        <AppText variant="caption">{markPrice != null ? `Mark ${price(markPrice)} · tap to update` : 'Tap to enter the current price'}</AppText>
      </Card>

      <Card>
        <View style={styles.grid}>
          <Metric label="Entry" value={price(trade.entryPrice)} />
          <Metric label="Current" value={markPrice != null ? price(markPrice) : '—'} />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Stop" value={price(trade.stopPrice)} tone="danger" sub={trade.stopPrice !== trade.originalStopPrice ? `Original ${price(trade.originalStopPrice)}` : undefined} />
          <Metric label="Target" value={price(trade.targetPrice)} tone="positive" />
        </View>
        <View style={[styles.grid, { marginTop: spacing.lg }]}>
          <Metric label="Planned risk" value={money(trade.riskDollars)} />
          <Metric label="Risk remaining today" value={money(guard?.riskRemaining)} />
        </View>
      </Card>

      <View style={styles.actions}>
        <Button label="Move stop" variant="secondary" icon="swap-vertical" size="md" style={styles.flex} onPress={() => { setNewStop(String(trade.stopPrice)); setSheet('stop'); }} />
        <Button label="Edit target" variant="secondary" icon="flag-outline" size="md" style={styles.flex} onPress={() => { setNewTarget(trade.targetPrice != null ? String(trade.targetPrice) : ''); setSheet('target'); }} />
      </View>
      <View style={styles.actions}>
        <Button label="Add note" variant="secondary" icon="create-outline" size="md" style={styles.flex} onPress={() => { setNote(trade.notes); setSheet('note'); }} />
        <Button label="Close trade" variant="primary" icon="exit-outline" size="md" style={styles.flex} onPress={() => { setExit(mark); setSheet('close'); }} />
      </View>

      {trade.notes ? (
        <Card>
          <AppText variant="label">Notes</AppText>
          <AppText variant="body" style={{ marginTop: spacing.sm }}>
            {trade.notes}
          </AppText>
        </Card>
      ) : null}

      <Sheet visible={sheet === 'mark'} onClose={() => setSheet('none')} title="Current price">
        <NumericInput label="Mark price" value={mark} onChangeText={setMark} autoFocus large placeholder={price(trade.entryPrice)} />
        <AppText variant="caption">Live prices arrive with Connected Broker mode. For now, enter the price from your platform.</AppText>
        <Button label="Update" onPress={() => setSheet('none')} />
      </Sheet>

      <Sheet visible={sheet === 'stop'} onClose={() => setSheet('none')} title="Moving stop">
        <View style={styles.grid}>
          <Metric label="Original stop" value={price(trade.originalStopPrice)} />
          <Metric label="Current stop" value={price(trade.stopPrice)} />
        </View>
        <NumericInput label="New stop" value={newStop} onChangeText={setNewStop} autoFocus large />
        {stopVal != null && delta !== 0 ? (
          <AppText variant="bodyStrong" tone={widened ? 'danger' : 'positive'}>
            {widened ? `Increases risk by ${money(delta)}` : `Reduces risk by ${money(-delta)}`}
          </AppText>
        ) : null}
        {stopInvalid ? (
          <AppText variant="caption" tone="danger">
            That stop is on the wrong side of the current price.
          </AppText>
        ) : null}
        <Button label="Confirm stop" disabled={stopVal == null || stopInvalid} onPress={onConfirmStop} />
      </Sheet>

      <WarningSheet
        visible={sheet === 'stopWarning'}
        title="Moving stop"
        tone="danger"
        lines={[
          `This increases your original trade risk by ${money(delta)}.`,
          rules.allowStopWidening ? 'Your rules allow widening, but it will still be recorded.' : 'Your strategy does not allow widening stops.',
        ]}
        question="Continue anyway?"
        overrideLabel="Override"
        onOverride={() => applyStop(true)}
        onCancel={() => setSheet('none')}>
        <View style={styles.grid}>
          <Metric label="Original stop" value={price(trade.originalStopPrice)} />
          <Metric label="New stop" value={price(stopVal)} tone="danger" />
        </View>
      </WarningSheet>

      <Sheet visible={sheet === 'target'} onClose={() => setSheet('none')} title="Edit target">
        <NumericInput label="Target" value={newTarget} onChangeText={setNewTarget} autoFocus large />
        <Button
          label="Save target"
          disabled={parseNum(newTarget) == null}
          onPress={() => {
            updateTrade(trade.id, { targetPrice: parseNum(newTarget) });
            setSheet('none');
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'note'} onClose={() => setSheet('none')} title="Add note">
        <Input label="Note" value={note} onChangeText={setNote} multiline autoFocus placeholder="What are you seeing? How do you feel?" />
        <Button
          label="Save note"
          onPress={() => {
            updateTrade(trade.id, { notes: note.trim() });
            setSheet('none');
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'close'} onClose={() => setSheet('none')} title="Close trade">
        <NumericInput label="Exit price" value={exit} onChangeText={setExit} autoFocus large />
        <View style={styles.actions}>
          {trade.targetPrice != null ? <Button label="At target" variant="secondary" size="md" style={styles.flex} onPress={() => setExit(String(trade.targetPrice))} /> : null}
          <Button label="At stop" variant="secondary" size="md" style={styles.flex} onPress={() => setExit(String(trade.stopPrice))} />
          <Button label="Breakeven" variant="secondary" size="md" style={styles.flex} onPress={() => setExit(String(trade.entryPrice))} />
        </View>
        {exitVal != null ? (
          <View style={styles.preview}>
            <Ionicons name="calculator-outline" size={16} color={colors.textSecondary} />
            <AppText variant="bodyStrong">
              Result: {money(openPnl(trade.instrument, trade.direction, trade.entryPrice, exitVal, trade.contracts), { sign: true })}
            </AppText>
          </View>
        ) : null}
        <Button label="Close trade" disabled={exitVal == null || exitVal <= 0} onPress={() => exitVal != null && onClose(exitVal)} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 4 },
  grid: { flexDirection: 'row', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
