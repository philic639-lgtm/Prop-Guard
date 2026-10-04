import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, FieldRow } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { formatPrice, practiceTradeMetrics, validatePracticeTrade } from '@/lib/engines';
import type { PracticeDecision as Decision, PracticeTradeInput } from '@/types/practice';
import { money, parseNum } from '@/utils/format';

interface PracticeDecisionProps {
  instrument: string;
  /** Close of the last visible candle (pre-fills the entry). */
  lastClose: number;
  onSubmit: (input: PracticeTradeInput) => void;
  /** Label for standing aside (historical mode says SKIP). */
  waitLabel?: string;
  /** Overrides the submit label (historical mode: "Lock Decision"). */
  submitLabel?: string;
}

/** LONG / SHORT / WAIT (or SKIP), then entry / stop / target with live risk, reward and R:R. */
export function PracticeDecision({ instrument, lastClose, onSubmit, waitLabel = 'WAIT', submitLabel }: PracticeDecisionProps) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [entry, setEntry] = useState(formatPrice(instrument, lastClose));
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');

  const input: PracticeTradeInput = { decision: decision ?? 'wait', entry: parseNum(entry) ?? undefined, stop: parseNum(stop) ?? undefined, target: parseNum(target) ?? undefined };
  const trading = decision === 'long' || decision === 'short';
  const filled = input.entry != null && input.stop != null && input.target != null;
  const error = trading && filled ? validatePracticeTrade(input) : null;
  const m = trading && filled && !error ? practiceTradeMetrics(instrument, input.entry!, input.stop!, input.target!) : null;
  const pts = (v: number) => `${Number(v.toFixed(4))} pts`;

  return (
    <Card>
      <AppText variant="label">Your decision</AppText>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Based only on what you can see — the rest of the session is hidden.
      </AppText>
      <View style={styles.row}>
        <Choice label="LONG" icon="arrow-up" tone={colors.positive} selected={decision === 'long'} onPress={() => setDecision('long')} />
        <Choice label="SHORT" icon="arrow-down" tone={colors.danger} selected={decision === 'short'} onPress={() => setDecision('short')} />
        <Choice label={waitLabel} icon="pause" tone={colors.textSecondary} selected={decision === 'wait'} onPress={() => setDecision('wait')} />
      </View>

      {trading ? (
        <View style={{ marginTop: spacing.md }}>
          <FieldRow label="Entry" value={entry} onChangeText={setEntry} placeholder="Price" />
          <FieldRow label="Stop loss" value={stop} onChangeText={setStop} placeholder="Price" error={error && /stop/i.test(error) ? error : null} />
          <FieldRow label="Target" value={target} onChangeText={setTarget} placeholder="Price" error={error && /target/i.test(error) ? error : null} />
          <View style={styles.metrics}>
            <Metric label="Risk" value={m ? pts(m.riskPoints) : '—'} sub={m?.riskDollarsPerContract != null ? `${money(m.riskDollarsPerContract)} / contract` : undefined} color={colors.danger} />
            <Metric label="Reward" value={m ? pts(m.rewardPoints) : '—'} color={colors.positive} />
            <Metric label="R:R" value={m ? `1:${m.rr}` : '—'} color={colors.accentBright} />
          </View>
        </View>
      ) : null}

      {decision === 'wait' ? (
        <AppText variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
          {waitLabel} means the strategy rules are not met here, so you would stand aside.
        </AppText>
      ) : null}

      <Button
        label={submitLabel ?? (decision === 'wait' ? 'Submit Wait' : 'Submit Trade')}
        icon={submitLabel ? 'lock-closed' : 'checkmark'}
        style={{ marginTop: spacing.lg }}
        disabled={!decision || (trading && (!filled || !!error))}
        onPress={() => decision && onSubmit(decision === 'wait' ? { decision: 'wait' } : input)}
      />
    </Card>
  );
}

function Choice({ label, icon, tone, selected, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; tone: string; selected: boolean; onPress: () => void }) {
  return (
    <View style={styles.flex}>
      <Button
        label={label}
        icon={icon}
        size="md"
        variant={selected ? (label === 'LONG' ? 'success' : label === 'SHORT' ? 'danger' : 'primary') : 'secondary'}
        onPress={onPress}
        accessibilityHint={`Choose ${label}`}
      />
      {selected ? <View style={[styles.underline, { backgroundColor: tone }]} /> : null}
    </View>
  );
}

function Metric({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <View style={styles.flex}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ color }}>
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" style={{ fontSize: 11 }}>
          {sub}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
  underline: { height: 3, borderRadius: 2, marginTop: 4, marginHorizontal: spacing.lg },
  metrics: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
});
