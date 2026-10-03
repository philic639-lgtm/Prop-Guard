import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, DetailTable, FieldRow, Screen, SegmentedControl, Stepper } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { useActiveAccount, useActiveStrategy } from '@/hooks/useAppData';
import { calculateTradeRisk, getInstrument, INSTRUMENT_SYMBOLS, maxContractsForRisk } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { money, parseNum, points, rr } from '@/utils/format';

/** Risk & position calculator. All multipliers come from the instrument engine. */
export default function CalculatorScreen() {
  const account = useActiveAccount();
  const strategy = useActiveStrategy();
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const ruleMaxRisk = useAppStore((s) => s.tradingRules.maxRiskPerTrade);
  const setDraft = useAppStore((s) => s.setDraft);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction>('long');
  const [entry, setEntry] = useState('6742.50');
  const [stop, setStop] = useState('6737.50');
  const [target, setTarget] = useState('6752.50');
  const [contracts, setContracts] = useState(2);
  const [accountSize, setAccountSize] = useState(String(account?.balance ?? 25000));
  const [maxRisk, setMaxRisk] = useState(String(ruleMaxRisk));

  const spec = getInstrument(instrument);
  const limit = parseNum(maxRisk) ?? ruleMaxRisk;
  const r = calculateTradeRisk({
    instrument,
    direction,
    entry: parseNum(entry),
    stop: parseNum(stop),
    target: parseNum(target),
    contracts,
    accountBalance: parseNum(accountSize),
  });
  const e = parseNum(entry);
  const s = parseNum(stop);
  const sized = e != null && s != null && e !== s ? maxContractsForRisk(instrument, e, s, limit, account?.rules.maxContracts) : null;
  const overRisk = r.valid && (r.riskDollars ?? 0) > limit;
  const overContracts = account?.rules.maxContracts != null && contracts > account.rules.maxContracts;
  const compliant = r.valid && !overRisk && !overContracts;

  return (
    <Screen
      header={<AppHeader title="Risk & position" back />}
      footer={
        <Button
          label="Check this trade"
          icon="shield-checkmark"
          disabled={!r.valid}
          onPress={() => {
            setDraft({ ...newDraft(strategy, instrument), instrument, direction, entry, stop, target, contracts: String(contracts) });
            router.push('/analyze');
          }}
        />
      }>
      <SegmentedControl options={INSTRUMENT_SYMBOLS.map((x) => ({ value: x, label: x }))} value={instrument} onChange={setInstrument} />
      <AppText variant="caption">
        {spec.name} · ${spec.pointValue}/pt · tick {spec.tickSize} = ${spec.tickValue}
      </AppText>
      <SegmentedControl
        options={[
          { value: 'long', label: 'LONG', tone: 'positive' },
          { value: 'short', label: 'SHORT', tone: 'danger' },
        ]}
        value={direction}
        onChange={setDirection}
      />

      <Card>
        <FieldRow label="Entry Price" value={entry} onChangeText={setEntry} />
        <FieldRow label="Stop Price" value={stop} onChangeText={setStop} />
        <FieldRow label="Target Price" value={target} onChangeText={setTarget} placeholder="Optional" />
        <FieldRow label="Contracts" control={<Stepper label="Contracts" value={contracts} onChange={setContracts} />} />
        <FieldRow label="Account Size" prefix="$" value={accountSize} onChangeText={setAccountSize} />
        <FieldRow label="Max Risk" prefix="$" value={maxRisk} onChangeText={setMaxRisk} />
      </Card>

      <Card raised>
        <DetailTable
          rows={[
            { label: 'Stop distance', value: r.pointsRisk != null ? `${points(r.pointsRisk)} · ${r.ticksRisk} ticks` : '—' },
            { label: 'Dollar risk', value: money(r.riskDollars), tone: overRisk ? 'danger' : 'primary', bold: true },
            { label: 'Dollar reward', value: money(r.rewardDollars), tone: r.rewardDollars ? 'positive' : 'primary' },
            { label: 'Risk : Reward', value: rr(r.rr) },
            { label: 'Account risk', value: r.accountRiskPct != null ? `${r.accountRiskPct.toFixed(2)}%` : '—' },
            { label: 'Max position size', value: sized != null ? `${sized} ${instrument}` : '—' },
          ]}
        />
      </Card>

      {!r.valid ? (
        <Card tone="warning">
          <AppText variant="body">{r.errors[0]}</AppText>
        </Card>
      ) : (
        <Card tone={compliant ? 'positive' : 'danger'}>
          <View style={styles.row}>
            <Ionicons name={compliant ? 'checkmark-circle' : 'close-circle'} size={22} color={compliant ? colors.positive : colors.danger} />
            <AppText variant="heading" style={{ color: compliant ? colors.positive : colors.danger }}>
              {compliant ? 'PLAN COMPLIANT' : 'RISK LIMIT EXCEEDED'}
            </AppText>
          </View>
          <AppText variant="body" style={{ marginTop: spacing.xs }}>
            {compliant
              ? `This trade is within your ${money(limit)} risk limit.`
              : overRisk
                ? `${money(r.riskDollars)} risk exceeds your ${money(limit)} limit. Use ${sized ?? 0} ${instrument} or a closer stop.`
                : `${contracts} contracts exceeds your account maximum of ${account?.rules.maxContracts}.`}
          </AppText>
          {!compliant && spec.micro && sized === 0 && e != null && s != null ? (
            <AppText variant="caption" style={{ marginTop: spacing.xs }}>
              Consider {spec.micro}: up to {maxContractsForRisk(spec.micro, e, s, limit)} contracts fit your limit.
            </AppText>
          ) : null}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
