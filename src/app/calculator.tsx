import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Card, Metric, NumericInput, Screen, SegmentedControl } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useActiveAccount } from '@/hooks/useAppData';
import { calculateTradeRisk, getInstrument, INSTRUMENT_SYMBOLS, maxContractsForRisk } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { money, parseNum, points, rr } from '@/utils/format';

/** Fast, free-tier risk calculator. All multipliers come from the instrument engine. */
export default function CalculatorScreen() {
  const account = useActiveAccount();
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const maxRisk = useAppStore((s) => s.tradingRules.maxRiskPerTrade);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction>('long');
  const [entry, setEntry] = useState('6040');
  const [stop, setStop] = useState('6035');
  const [target, setTarget] = useState('');
  const [contracts, setContracts] = useState('1');
  const [balance, setBalance] = useState(String(account?.balance ?? 25000));

  const spec = getInstrument(instrument);
  const r = calculateTradeRisk({
    instrument,
    direction,
    entry: parseNum(entry),
    stop: parseNum(stop),
    target: parseNum(target),
    contracts: parseNum(contracts),
    accountBalance: parseNum(balance),
  });
  const e = parseNum(entry);
  const s = parseNum(stop);
  const sized = e != null && s != null && e !== s ? maxContractsForRisk(instrument, e, s, maxRisk, account?.rules.maxContracts) : null;

  return (
    <Screen header={<AppHeader title="Risk calculator" back />}>
      <SegmentedControl label="Instrument" options={INSTRUMENT_SYMBOLS.map((x) => ({ value: x, label: x }))} value={instrument} onChange={setInstrument} />
      <AppText variant="caption">
        {spec.name} · ${spec.pointValue}/pt · tick {spec.tickSize} = ${spec.tickValue}
      </AppText>
      <SegmentedControl
        label="Direction"
        options={[
          { value: 'long', label: 'Long', tone: 'positive' },
          { value: 'short', label: 'Short', tone: 'danger' },
        ]}
        value={direction}
        onChange={setDirection}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={entry} onChangeText={setEntry} large />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={stop} onChangeText={setStop} large />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Target (optional)" value={target} onChangeText={setTarget} large />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Contracts" value={contracts} onChangeText={(t) => setContracts(t.replace(/\D/g, ''))} keyboardType="number-pad" large />
        </View>
      </View>
      <NumericInput label="Account balance" prefix="$" value={balance} onChangeText={setBalance} />

      <Card raised>
        <AppText variant="label">Risk</AppText>
        <AppText variant="hero" tone={r.riskDollars != null && r.riskDollars > maxRisk ? 'danger' : 'primary'}>
          {money(r.riskDollars)}
        </AppText>
        <View style={[styles.row, { marginTop: spacing.lg }]}>
          <Metric label="Distance" value={points(r.pointsRisk)} compact />
          <Metric label="Ticks" value={r.ticksRisk != null ? String(r.ticksRisk) : '—'} compact />
          <Metric label="Account risk" value={r.accountRiskPct != null ? `${r.accountRiskPct.toFixed(2)}%` : '—'} compact />
        </View>
        {r.rr != null ? (
          <View style={[styles.row, { marginTop: spacing.lg }]}>
            <Metric label="Reward" value={money(r.rewardDollars)} tone="positive" compact />
            <Metric label="R:R" value={rr(r.rr)} compact />
            <Metric label="Pts reward" value={points(r.pointsReward)} compact />
          </View>
        ) : null}
        {!r.valid && r.errors.length ? (
          <AppText variant="caption" tone="danger" style={{ marginTop: spacing.md }}>
            {r.errors[0]}
          </AppText>
        ) : null}
      </Card>

      {sized != null ? (
        <Card>
          <AppText variant="label">Position size for your {money(maxRisk)} max risk</AppText>
          <AppText variant="display" style={{ marginTop: spacing.xs }}>
            {sized} {instrument}
          </AppText>
          {spec.micro && sized === 0 ? (
            <AppText variant="caption">
              Too wide for 1 {instrument}. Consider {spec.micro}: {maxContractsForRisk(spec.micro, e!, s!, maxRisk)} contracts.
            </AppText>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
