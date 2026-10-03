import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveTradeChart } from '@/components/charts/LiveTradeChart';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  EmptyState,
  Input,
  Metric,
  MetricTile,
  NotificationCard,
  NumericInput,
  Screen,
  Sheet,
  StatusBadge,
  TileGrid,
  ToggleRow,
  WarningSheet,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useDailyGuard, useStrategy, useTrade } from '@/hooks/useAppData';
import { closedTradeAlert, getInstrument, isStopWidened, liveAlerts, liveState, openPnl, roundToTick, stopChangeRiskDelta, type LiveAlert } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { AlertKind, Trade } from '@/types/domain';
import { money, parseNum, price } from '@/utils/format';

type SheetKind = 'none' | 'stop' | 'stopWarning' | 'target' | 'close' | 'note' | 'mark';

export default function LiveTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trade = useTrade(id);

  if (!trade) {
    return (
      <Screen header={<AppHeader title="Live trade monitor" back />}>
        <EmptyState icon="pulse-outline" title="Trade not found" message="This trade may have been closed or removed." actionLabel="Back to check trade" onAction={() => router.replace('/analyze')} />
      </Screen>
    );
  }
  if (trade.status !== 'open') {
    return (
      <Screen header={<AppHeader title="Live trade monitor" back />}>
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
  return <LiveMonitor trade={trade} />;
}

function seedPrices(trade: Trade): number[] {
  const tick = getInstrument(trade.instrument).tickSize;
  const sign = trade.direction === 'long' ? 1 : -1;
  return Array.from({ length: 16 }, (_, i) => roundToTick(trade.instrument, trade.entryPrice - sign * (15 - i) * tick * (i % 3 === 0 ? 1.5 : 0.8)));
}

function LiveMonitor({ trade }: { trade: Trade }) {
  const strategy = useStrategy(trade.strategyId);
  const guard = useDailyGuard();
  const rules = useAppStore((s) => s.tradingRules);
  const demo = useAppStore((s) => s.mode === 'demo');
  const updateTrade = useAppStore((s) => s.updateTrade);
  const closeTrade = useAppStore((s) => s.closeTrade);
  const recordEvent = useAppStore((s) => s.recordEvent);
  const pushAlert = useAppStore((s) => s.pushAlert);

  const [sheet, setSheet] = useState<SheetKind>('none');
  const [prices, setPrices] = useState<number[]>(() => seedPrices(trade));
  const [markInput, setMarkInput] = useState('');
  const [newStop, setNewStop] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [exit, setExit] = useState('');
  const [note, setNote] = useState('');
  const [feed, setFeed] = useState(demo);
  const [toast, setToast] = useState<LiveAlert | null>(null);
  const sent = useRef(new Set<AlertKind>());
  const markPrice = prices[prices.length - 1];
  const insets = useSafeAreaInsets();

  const pushPrice = useCallback((p: number) => setPrices((cur) => [...cur.slice(-59), p]), []);

  // Demo price feed — a random walk with a slight drift. Replaced by broker marks later.
  useEffect(() => {
    if (!feed) return;
    const tick = getInstrument(trade.instrument).tickSize;
    const t = setInterval(() => {
      setPrices((cur) => {
        const last = cur[cur.length - 1];
        const step = (Math.random() < 0.56 ? 1 : -1) * (trade.direction === 'long' ? 1 : -1) * tick * (1 + Math.floor(Math.random() * 4));
        return [...cur.slice(-59), roundToTick(trade.instrument, last + step)];
      });
    }, 1400);
    return () => clearInterval(t);
  }, [feed, trade.instrument, trade.direction]);

  // Turn price moves into alerts (in-app feed + toast).
  useEffect(() => {
    const fresh = liveAlerts(trade, markPrice, sent.current);
    if (fresh.length === 0) return;
    for (const a of fresh) {
      sent.current.add(a.kind);
      pushAlert({ kind: a.kind, title: a.title, body: a.body, tradeId: trade.id });
    }
    const latest = fresh[fresh.length - 1];
    setToast(latest);
    const s = liveState(trade, markPrice);
    if (s.targetHit || s.stopHit) {
      setFeed(false);
      setExit(String(s.targetHit ? trade.targetPrice : trade.stopPrice));
      setSheet('close');
    }
    const h = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(h);
  }, [markPrice, trade, pushAlert]);

  const live = liveState(trade, markPrice);
  const stopVal = parseNum(newStop);
  const widened = stopVal != null && isStopWidened(trade.direction, trade.stopPrice, stopVal);
  const delta = stopVal != null ? stopChangeRiskDelta(trade.instrument, trade.direction, trade.entryPrice, trade.stopPrice, stopVal, trade.contracts) : 0;
  const stopInvalid = stopVal != null && (trade.direction === 'long' ? stopVal >= markPrice : stopVal <= markPrice);

  const applyStop = (override: boolean, value = stopVal) => {
    if (value == null) return;
    updateTrade(trade.id, {
      stopPrice: value,
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
        detail: `Stop moved from ${price(trade.stopPrice)} to ${price(value)} (+${money(delta)} risk).`,
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
    setFeed(false);
    const closed = closeTrade(trade.id, exitPrice);
    setSheet('none');
    if (!closed) return;
    const a = closedTradeAlert(closed);
    pushAlert({ kind: a.kind, title: a.title, body: a.body, tradeId: closed.id });
    if ((closed.pnl ?? 0) < 0) router.replace({ pathname: '/session/loss', params: { id: closed.id } });
    else router.replace({ pathname: '/journal/[id]', params: { id: closed.id, edit: '1' } });
  };

  const exitVal = parseNum(exit);
  const atBreakeven = live.stopAtBreakevenOrBetter;

  return (
    <View style={styles.root}>
      <Screen
        header={<AppHeader title="Live trade monitor" back right={<StatusBadge label="Active" tone="positive" />} />}
        footer={
          <View style={styles.actions}>
            <Button label="Move to Breakeven" variant="secondary" size="md" style={styles.flex} disabled={atBreakeven || live.r <= 0} onPress={() => applyStop(false, trade.entryPrice)} />
            <Button label="Close Trade" variant="danger" size="md" style={styles.flex} onPress={() => { setExit(String(markPrice)); setSheet('close'); }} />
          </View>
        }>
        <Card>
          <View style={styles.tradeHead}>
            <View style={styles.instIcon}>
              <Ionicons name={trade.direction === 'long' ? 'trending-up' : 'trending-down'} size={20} color={colors.accentBright} />
            </View>
            <View style={styles.flex}>
              <AppText variant="heading">
                {trade.instrument} • {trade.direction === 'long' ? 'Long' : 'Short'} {trade.contracts}
              </AppText>
              <AppText variant="caption">{strategy?.name ?? 'No strategy'}</AppText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="number" tone={live.pnl >= 0 ? 'positive' : 'danger'}>
                {money(live.pnl, { sign: true })}
              </AppText>
              <AppText variant="caption">{live.r >= 0 ? '+' : ''}{live.r.toFixed(2)}R</AppText>
            </View>
          </View>
        </Card>

        <TileGrid>
          <MetricTile label="Entry" value={price(trade.entryPrice)} />
          <MetricTile label="Stop" value={price(trade.stopPrice)} tone={atBreakeven ? 'positive' : 'danger'} sub={trade.stopPrice !== trade.originalStopPrice ? `orig ${price(trade.originalStopPrice)}` : undefined} />
          <MetricTile label="Target" value={price(trade.targetPrice)} tone="positive" />
          <MetricTile label="Current" value={price(markPrice)} onPress={() => { setMarkInput(String(markPrice)); setSheet('mark'); }} sub="Tap to update" />
        </TileGrid>

        <Card>
          <LiveTradeChart prices={prices} entry={trade.entryPrice} stop={trade.stopPrice} target={trade.targetPrice} />
          {demo ? <ToggleRow label="Demo price feed" description="Simulated prices so you can preview live alerts." value={feed} onChange={setFeed} /> : null}
        </Card>

        <Card>
          <View style={styles.metrics}>
            <Metric label="Open P/L" value={money(live.pnl, { sign: true })} tone={live.pnl >= 0 ? 'positive' : 'danger'} compact />
            <Metric label="To stop" value={`${live.pointsToStop} pts`} compact />
            <Metric label="Session risk left" value={money(guard?.riskRemaining)} compact />
          </View>
        </Card>

        <View style={styles.actions}>
          <Button label="Move stop" variant="secondary" icon="swap-vertical" size="md" style={styles.flex} onPress={() => { setNewStop(String(trade.stopPrice)); setSheet('stop'); }} />
          <Button label="Edit target" variant="secondary" icon="flag-outline" size="md" style={styles.flex} onPress={() => { setNewTarget(trade.targetPrice != null ? String(trade.targetPrice) : ''); setSheet('target'); }} />
        </View>
        <Button label="Add note" variant="ghost" icon="create-outline" size="md" onPress={() => { setNote(trade.notes); setSheet('note'); }} />

        {trade.notes ? (
          <Card>
            <AppText variant="label">Notes</AppText>
            <AppText variant="body" style={{ marginTop: spacing.sm }}>
              {trade.notes}
            </AppText>
          </Card>
        ) : null}

      <Sheet visible={sheet === 'mark'} onClose={() => setSheet('none')} title="Current price">
        <NumericInput label="Mark price" value={markInput} onChangeText={setMarkInput} autoFocus large placeholder={price(trade.entryPrice)} />
        <AppText variant="caption">Live prices arrive with Connected Broker mode. Enter the price from your platform, or use the demo feed.</AppText>
        <Button
          label="Update"
          disabled={parseNum(markInput) == null}
          onPress={() => {
            const v = parseNum(markInput);
            if (v != null) pushPrice(v);
            setSheet('none');
          }}
        />
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
      {toast ? (
        <View style={[styles.toast, { top: insets.top + 60 }]} pointerEvents="box-none">
          <NotificationCard kind={toast.kind} title={toast.title} body={toast.body} time="now" highlight onPress={() => setToast(null)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  grid: { flexDirection: 'row', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md },
  metrics: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tradeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  instIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', left: 16, right: 16 },
});
