import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, Input, NumericInput, Screen, SectionHeader, SegmentedControl, StatusBadge, ToggleRow } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { ASSET_LABEL, FOLLOW_UI, MODE_LABEL, PLATFORM_ICON, PLATFORM_LABEL, SIZING_LABEL, STYLES } from '@/features/copyTrade/copyUi';
import { useCopyAnalytics, useSourceTrader } from '@/features/copyTrade/useCopyTrade';
import { copyResult, DEFAULT_COPY_SETTINGS, FOLLOW_LABEL } from '@/lib/engines/copyTradeEngine';
import { useAppStore } from '@/store/useAppStore';
import type { CopyAssetClass, CopyPlatform, CopySettings, CopySizingMode, SourceTrader } from '@/types/copyTrade';
import { money, parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';
import { goBack } from '@/utils/navigation';

const PLATFORMS = Object.keys(PLATFORM_LABEL) as CopyPlatform[];
const ASSETS = Object.keys(ASSET_LABEL) as CopyAssetClass[];
const SIZING: CopySizingMode[] = ['fixed_risk', 'percent_risk', 'scale', 'mirror'];
const str = (n: number | null | undefined) => (n == null ? '' : String(n));
const list = (t: string) => [...new Set(t.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];

/** Add / edit a source trader and how you copy them; archive; their copy history. */
export default function SourceTraderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = useSourceTrader(id === 'new' ? null : id);
  const accounts = useAppStore((s) => s.accounts);
  const upsert = useAppStore((s) => s.upsertSourceTrader);
  const archive = useAppStore((s) => s.archiveSourceTrader);
  const copies = useAppStore((s) => s.copyTrades);
  const trades = useAppStore((s) => s.trades);
  const analytics = useCopyAnalytics();
  const stats = existing ? analytics.traders.find((t) => t.sourceTraderId === existing.id) : undefined;
  const s0 = existing?.settings ?? DEFAULT_COPY_SETTINGS;

  const [name, setName] = useState(existing?.name ?? '');
  const [platform, setPlatform] = useState<CopyPlatform>(existing?.platform ?? 'discord');
  const [asset, setAsset] = useState<CopyAssetClass>(existing?.assetClass ?? 'futures');
  const [instruments, setInstruments] = useState(existing?.instruments.join(', ') ?? '');
  const [style, setStyle] = useState<string | null>(existing?.style ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [trust, setTrust] = useState<number | null>(existing?.trustRating ?? null);
  const [active, setActive] = useState(existing?.isActive ?? true);
  const [accountId, setAccountId] = useState<string | null>(s0.accountId);
  const [sizing, setSizing] = useState<CopySizingMode>(s0.sizingMode);
  const [fixedRisk, setFixedRisk] = useState(str(s0.fixedRisk));
  const [percent, setPercent] = useState(str(s0.percentRisk));
  const [scaleSource, setScaleSource] = useState(str(s0.scale?.source));
  const [scaleMine, setScaleMine] = useState(str(s0.scale?.mine));
  const [maxContracts, setMaxContracts] = useState(str(s0.maxContracts));
  const [maxPerDay, setMaxPerDay] = useState(str(s0.maxTradesPerDay));
  const [allowed, setAllowed] = useState(s0.allowedInstruments.join(', '));
  const [start, setStart] = useState(s0.session?.start ?? '');
  const [end, setEnd] = useState(s0.session?.end ?? '');
  const [aPlus, setAPlus] = useState(s0.aPlusOnly);
  const [confirm, setConfirm] = useState(s0.requireManualConfirm);
  const [blockNear, setBlockNear] = useState(s0.blockNearLimit);
  const [error, setError] = useState<string | null>(null);

  const history = useMemo(() => {
    if (!existing) return [];
    const byId = new Map(trades.map((t) => [t.id, t]));
    return copies
      .filter((c) => c.sourceTraderId === existing.id)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 20)
      .map((c) => ({ c, res: copyResult(c, byId) }));
  }, [existing, copies, trades]);

  const sizingMissing =
    (sizing === 'fixed_risk' && !(parseNum(fixedRisk)! > 0)) ||
    (sizing === 'percent_risk' && !(parseNum(percent)! > 0)) ||
    (sizing === 'scale' && !(parseNum(scaleSource)! > 0 && parseNum(scaleMine)! >= 0));
  const timeOk = (t: string) => !t || /^\d{1,2}:\d{2}$/.test(t.trim());

  const save = () => {
    if (!name.trim()) return setError('Give the trader a name or alias.');
    if (!timeOk(start) || !timeOk(end) || (!!start !== !!end)) return setError('Copy hours need both times as HH:MM (e.g. 09:30 and 11:00), or leave both empty.');
    if (sizing === 'percent_risk' && (parseNum(percent) ?? 0) > 5) return setError('Percent risk above 5% per copy is not allowed here — that is oversizing.');
    const settings: CopySettings = {
      accountId,
      sizingMode: sizing,
      fixedRisk: parseNum(fixedRisk),
      percentRisk: parseNum(percent),
      scale: parseNum(scaleSource) && parseNum(scaleMine) != null ? { source: parseNum(scaleSource)!, mine: parseNum(scaleMine)! } : null,
      maxContracts: parseNum(maxContracts) != null ? Math.floor(parseNum(maxContracts)!) : null,
      maxTradesPerDay: parseNum(maxPerDay) != null ? Math.floor(parseNum(maxPerDay)!) : null,
      allowedInstruments: list(allowed),
      session: start && end ? { start: start.trim(), end: end.trim() } : null,
      aPlusOnly: aPlus,
      requireManualConfirm: confirm,
      blockNearLimit: blockNear,
    };
    const now = new Date().toISOString();
    const trader: SourceTrader = {
      id: existing?.id ?? uuid(),
      name: name.trim().slice(0, 80),
      platform,
      assetClass: asset,
      instruments: list(instruments),
      style,
      notes: notes.trim(),
      trustRating: trust,
      isActive: active,
      archived: existing?.archived ?? false,
      settings,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    upsert(trader);
    goBack('/copy');
  };

  return (
    <Screen
      header={<AppHeader title={existing ? 'Source trader' : 'Add source trader'} subtitle={existing?.name ?? 'Who you copy and how'} back />}
      footer={<Button label={existing ? 'Save changes' : 'Save trader'} icon="checkmark" onPress={save} />}>
      {stats && stats.logged > 0 ? (
        <Card accent={FOLLOW_UI[stats.verdict].tone}>
          <StatusBadge label={FOLLOW_LABEL[stats.verdict]} tone={FOLLOW_UI[stats.verdict].tone} icon={FOLLOW_UI[stats.verdict].icon} />
          <AppText variant="caption" style={styles.mt}>
            {stats.verdictReason}
          </AppText>
          <View style={styles.statsRow}>
            <Fig label="Copies" value={String(stats.logged)} />
            <Fig label="Win rate" value={stats.winRate != null ? `${Math.round(stats.winRate * 100)}%` : '—'} />
            <Fig label="Avg R" value={stats.avgR != null ? stats.avgR.toFixed(2) : '—'} />
            <Fig label="Live P&L" value={stats.live ? money(stats.netPnl) : '—'} />
          </View>
          {stats.hypotheticalPnl !== 0 ? (
            <AppText variant="caption" tone="tertiary">
              Simulated / missed copies at your size: {money(stats.hypotheticalPnl, { sign: true })} (hypothetical).
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <SectionHeader title="Trader" />
      <Input label="Name or alias" value={name} onChangeText={setName} placeholder="e.g. NQ Scalper (Discord)" maxLength={80} error={error && !name.trim() ? error : null} />
      <View style={styles.gap}>
        <AppText variant="label">Platform</AppText>
        <View style={styles.chips}>
          {PLATFORMS.map((p) => (
            <Chip key={p} label={PLATFORM_LABEL[p]} icon={PLATFORM_ICON[p]} selected={platform === p} onPress={() => setPlatform(p)} />
          ))}
        </View>
      </View>
      <View style={styles.gap}>
        <AppText variant="label">Asset class</AppText>
        <View style={styles.chips}>
          {ASSETS.map((a) => (
            <Chip key={a} label={ASSET_LABEL[a]} selected={asset === a} onPress={() => setAsset(a)} />
          ))}
        </View>
      </View>
      <Input label="Instruments they trade" value={instruments} onChangeText={setInstruments} placeholder="ES, NQ, MNQ" autoCapitalize="characters" />
      <View style={styles.gap}>
        <AppText variant="label">Style</AppText>
        <View style={styles.chips}>
          {STYLES.map((x) => (
            <Chip key={x} label={x} selected={style === x} onPress={() => setStyle(style === x ? null : x)} />
          ))}
        </View>
      </View>
      <View style={styles.gap}>
        <AppText variant="label">Your trust rating (optional)</AppText>
        <View style={styles.chips}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} label={'★'.repeat(n)} selected={trust === n} onPress={() => setTrust(trust === n ? null : n)} />
          ))}
        </View>
      </View>
      <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="What they are good at, when they struggle…" multiline maxLength={1000} />
      <ToggleRow label="Active" description="Paused traders stay in your history but are not offered when logging." value={active} onChange={setActive} />

      <SectionHeader title="How you copy them" />
      {accounts.length ? (
        <View style={styles.gap}>
          <AppText variant="label">Check copies against</AppText>
          <View style={styles.chips}>
            <Chip label="Active account" selected={accountId == null} onPress={() => setAccountId(null)} />
            {accounts.map((a) => (
              <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
            ))}
          </View>
        </View>
      ) : (
        <Card tone="warning">
          <AppText variant="caption">Add your trading account so Prop Guard can check copies against your daily loss limit and drawdown.</AppText>
          <Button label="Add account" variant="secondary" size="md" onPress={() => router.push('/accounts/new')} style={styles.mt} />
        </Card>
      )}
      <SegmentedControl label="Sizing" options={SIZING.map((m) => ({ value: m, label: SIZING_LABEL[m] }))} value={sizing} onChange={setSizing} />
      {sizing === 'fixed_risk' ? <NumericInput label="Risk per copied trade" prefix="$" value={fixedRisk} onChangeText={setFixedRisk} placeholder="150" hint="Your size = this ÷ the risk of one contract." /> : null}
      {sizing === 'percent_risk' ? <NumericInput label="Risk per copy (% of balance)" suffix="%" value={percent} onChangeText={setPercent} placeholder="0.5" hint="Uses the checked account’s current balance." /> : null}
      {sizing === 'scale' ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <NumericInput label="When they trade" value={scaleSource} onChangeText={setScaleSource} placeholder="5" suffix="ct" />
          </View>
          <View style={styles.flex}>
            <NumericInput label="I trade" value={scaleMine} onChangeText={setScaleMine} placeholder="2" suffix="ct" />
          </View>
        </View>
      ) : null}
      {sizing === 'mirror' ? (
        <AppText variant="caption" tone="secondary">
          Mirror uses their contract count — still capped by your max contracts, max risk per trade and today’s remaining risk.
        </AppText>
      ) : null}
      {sizingMissing ? (
        <AppText variant="caption" tone="warning">
          Fill in the sizing so Prop Guard can size copies — until then every copy is “Requires manual review”.
        </AppText>
      ) : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Max contracts" value={maxContracts} onChangeText={setMaxContracts} placeholder="No cap" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Max copies / day" value={maxPerDay} onChangeText={setMaxPerDay} placeholder="No cap" />
        </View>
      </View>
      <Input label="Only copy these instruments" value={allowed} onChangeText={setAllowed} placeholder="Any (e.g. MNQ, MES)" autoCapitalize="characters" />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input label="Copy from" value={start} onChangeText={setStart} placeholder="09:30" maxLength={5} />
        </View>
        <View style={styles.flex}>
          <Input label="Until" value={end} onChangeText={setEnd} placeholder="11:30" maxLength={5} />
        </View>
      </View>
      <ToggleRow label="Only A+ setups" description="Copies you rate below A+ are blocked." value={aPlus} onChange={setAPlus} />
      <ToggleRow label="Confirm before logging" description="You confirm the translated size every time." value={confirm} onChange={setConfirm} />
      <ToggleRow label="Block near my limits" description="Block a copy that would leave under 25% of today’s risk." value={blockNear} onChange={setBlockNear} />
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}

      {existing ? (
        <>
          <SectionHeader title="Copy history" />
          {history.length === 0 ? (
            <AppText variant="caption" tone="tertiary">
              No copies logged from {existing.name} yet.
            </AppText>
          ) : (
            history.map(({ c, res }) => (
              <Card key={c.id} onPress={() => router.push({ pathname: '/copy/[id]', params: { id: c.id } })} padded>
                <View style={styles.histRow}>
                  <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {c.instrument} {c.direction === 'long' ? 'Long' : 'Short'} · {MODE_LABEL[c.mode]}
                  </AppText>
                  <AppText variant="bodyStrong" style={{ color: res.r == null ? colors.textSecondary : res.r >= 0 ? colors.positive : colors.danger }}>
                    {res.closed && res.r != null ? `${res.r.toFixed(2)}R` : 'Open'}
                  </AppText>
                </View>
              </Card>
            ))
          )}
          <Button
            label={existing.archived ? 'Restore trader' : 'Archive trader'}
            icon={existing.archived ? 'refresh' : 'archive-outline'}
            variant="secondary"
            onPress={() => {
              archive(existing.id, !existing.archived);
              goBack('/copy');
            }}
          />
          <AppText variant="caption" tone="tertiary" align="center">
            Archiving keeps every copy and journal entry; the trader just leaves your pickers.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fig}>
      <AppText variant="number" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" tone="tertiary" style={styles.figLabel} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing.sm },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  fig: { flex: 1, minWidth: 0 },
  figLabel: { fontSize: 11 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
