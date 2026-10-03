import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, DetailTable, FieldRow, Screen, SegmentedControl, SelectField, Stepper } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { useActiveAccount, useActiveStrategy } from '@/hooks/useAppData';
import { buildPendingTrade, calculateTradeRisk, getInstrument, instrumentOptions, maxContractsForRisk, specSummary } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { money, parseNum, points, rr } from '@/utils/format';
import { uuid } from '@/utils/id';

/** Risk & position calculator. All multipliers come from the instrument engine. */
export default function CalculatorScreen() {
  const account = useActiveAccount();
  const strategy = useActiveStrategy();
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const markets = useAppStore((s) => s.preferences.markets);
  const ruleMaxRisk = useAppStore((s) => s.tradingRules.maxRiskPerTrade);
  const setDraft = useAppStore((s) => s.setDraft);
  const upsertPendingTrade = useAppStore((s) => s.upsertPendingTrade);
  const pendingTrades = useAppStore((s) => s.pendingTrades);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction>('long');
  // Sample S&P prices only make sense for S&P contracts; other markets start blank.
  const sp = defaultInstrument === 'ES' || defaultInstrument === 'MES';
  const [entry, setEntry] = useState(sp ? '6742.50' : '');
  const [stop, setStop] = useState(sp ? '6737.50' : '');
  const [target, setTarget] = useState(sp ? '6752.50' : '');
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
  const savedPending = pendingTrades.find((p) => p.id === pendingId && p.status === 'pending') ?? null;
  const savedMatches =
    savedPending != null &&
    savedPending.instrument === instrument &&
    savedPending.direction === direction &&
    savedPending.entry === e &&
    savedPending.stop === s &&
    savedPending.target === parseNum(target) &&
    savedPending.contracts === contracts;

  /** Automatic journaling: keep this calculation as a pending trade to complete later. */
  const saveAsPending = () => {
    if (!account) return;
    const snap = buildPendingTrade({
      id: savedPending?.id ?? uuid(),
      accountId: account.id,
      strategyId: strategy?.id ?? null,
      instrument,
      direction,
      entry: e,
      stop: s,
      target: parseNum(target),
      contracts,
      accountBalance: parseNum(accountSize),
      origin: 'calculator',
      createdAt: savedPending?.createdAt,
      now: new Date(),
    });
    if (!snap) return;
    upsertPendingTrade(snap);
    setPendingId(snap.id);
  };

  return (
    <Screen
      header={<AppHeader title="Risk & position" back />}
      footer={
        <>
          <Button
            label="Check this trade"
            icon="shield-checkmark"
            disabled={!r.valid}
            onPress={() => {
              setDraft({ ...newDraft(strategy, instrument), instrument, direction, entry, stop, target, contracts: String(contracts) });
              router.push('/analyze');
            }}
          />
          <Button
            label={savedMatches ? 'Saved to Journal · pending' : savedPending ? 'Update pending trade' : 'Save to Journal as pending'}
            variant="secondary"
            icon={savedMatches ? 'checkmark' : 'book-outline'}
            disabled={!r.valid || !account || savedMatches}
            onPress={saveAsPending}
          />
        </>
      }>
      <SelectField
        label="Instrument"
        value={instrument}
        options={instrumentOptions(markets)}
        onChange={(v) => {
          // Prices from a different underlying are meaningless — clear them (ES ↔ MES keeps them).
          const underlying = (sym: string) => getInstrument(sym).mini ?? sym;
          if (underlying(v) !== underlying(instrument)) {
            setEntry('');
            setStop('');
            setTarget('');
          }
          setInstrument(v);
        }}
      />
      <AppText variant="caption">
        {spec.name}{spec.isMicro ? ' (micro)' : ''} · {specSummary(instrument)}
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

      {savedPending ? (
        <Card onPress={() => router.push({ pathname: '/journal/complete/[id]', params: { id: savedPending.id } })}>
          <View style={styles.row}>
            <Ionicons name="book" size={18} color={colors.accentBright} />
            <AppText variant="bodyStrong" style={styles.flex}>
              Pending in your Journal
            </AppText>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
          <AppText variant="caption" style={{ marginTop: spacing.xs }}>
            When the trade is done, add the exit or a screenshot and the full journal entry is created for you.
          </AppText>
        </Card>
      ) : null}

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

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, flex: { flex: 1 } });
