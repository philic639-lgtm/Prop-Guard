import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Chip, EmptyState, Input, NumericInput, Screen, SectionHeader, SegmentedControl, ToggleRow } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';
import { CopyVerdictCard } from '@/features/copyTrade/CopyVerdictCard';
import { MODE_LABEL, SIZING_LABEL } from '@/features/copyTrade/copyUi';
import { useCopyRiskContext, useSourceTraders } from '@/features/copyTrade/useCopyTrade';
import { buildCopiedTrade, snapshotOf, translateCopyTrade } from '@/lib/engines/copyTradeEngine';
import { findInstrument, instrumentOptions } from '@/lib/engines/instrumentEngine';
import { pickImages } from '@/services/accountImport/images';
import { useAppStore } from '@/store/useAppStore';
import type { CopyConviction, CopyMode, CopyTrade } from '@/types/copyTrade';
import { parseNum } from '@/utils/format';
import { uuid } from '@/utils/id';

const MODES: CopyMode[] = ['live', 'simulated', 'missed'];
const CONVICTION: CopyConviction[] = ['A+', 'A', 'B', 'C'];

/**
 * Log Copy Trade — quick entry. The review card updates as you type:
 * your size, estimated risk, daily risk impact and the rule check. Nothing is
 * executed; a live copy opens a journal trade you close as usual.
 */
export default function LogCopyTrade() {
  const params = useLocalSearchParams<{ traderId?: string }>();
  const traders = useSourceTraders();
  const choices = useMemo(() => traders.filter((t) => t.isActive), [traders]);
  const markets = useAppStore((s) => s.preferences.markets);
  const logCopy = useAppStore((s) => s.logCopyTrade);
  const accounts = useAppStore((s) => s.accounts);
  const [traderId, setTraderId] = useState<string | null>(params.traderId ?? choices[0]?.id ?? null);
  const trader = traders.find((t) => t.id === traderId) ?? null;
  const [instrument, setInstrument] = useState<string>(() => trader?.settings.allowedInstruments[0] ?? trader?.instruments.find((i) => findInstrument(i)) ?? markets[0] ?? 'MNQ');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [srcContracts, setSrcContracts] = useState('');
  const [srcInstrument, setSrcInstrument] = useState<string | null>(null);
  const [conviction, setConviction] = useState<CopyConviction | null>(null);
  const [mode, setMode] = useState<CopyMode>('live');
  const [setup, setSetup] = useState('');
  const [notes, setNotes] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ctx = useCopyRiskContext(trader, trader?.settings ?? null);
  const idea = useMemo(
    () => ({ instrument, direction, entry: parseNum(entry), stop: parseNum(stop), target: parseNum(target), sourceContracts: parseNum(srcContracts), sourceInstrument: srcInstrument ?? (parseNum(srcContracts) ? instrument : null), conviction }),
    [instrument, direction, entry, stop, target, srcContracts, srcInstrument, conviction],
  );
  const t = useMemo(() => (ctx ? translateCopyTrade(idea, ctx) : null), [idea, ctx]);
  const options = useMemo(() => instrumentOptions([...(trader?.instruments ?? []), ...markets]).slice(0, 10), [trader, markets]);
  const spec = findInstrument(instrument);
  const pairs = spec ? [spec.symbol, spec.micro, spec.mini].filter((x): x is string => !!x) : [instrument];

  if (choices.length === 0) {
    return (
      <Screen header={<AppHeader title="Log Copy Trade" back />}>
        <Card>
          <EmptyState illustration="copy" title="Add who you copy first" message="Copies are sized with each trader’s own copy settings." actionLabel="Add source trader" onAction={() => router.replace('/copy/trader/new')} />
        </Card>
      </Screen>
    );
  }

  const canTake = !!t && t.contracts != null && t.contracts >= 1 && (t.verdict === 'safe' || t.verdict === 'reduce');
  // Live copies need an allowed size; anything else can still be logged (as missed / simulated) for the record.
  const liveBlocked = mode === 'live' && !canTake;
  const needsConfirm = mode === 'live' && !!t?.needsConfirm;
  const ready = !!trader && !!t && idea.entry != null && idea.stop != null && !liveBlocked && (!needsConfirm || confirmed) && !saving;

  const save = () => {
    if (!ready || !trader || !t || !ctx) return;
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const copy: CopyTrade = {
      id: uuid(),
      sourceTraderId: trader.id,
      sourceTraderName: trader.name,
      accountId: ctx.account?.id ?? null,
      instrument,
      direction,
      entry: idea.entry!,
      stop: idea.stop!,
      target: idea.target,
      sourceContracts: idea.sourceContracts,
      sourceInstrument: idea.sourceInstrument,
      at: now,
      setup: setup.trim(),
      notes: notes.trim(),
      conviction,
      mode,
      screenshotUri: shot,
      contracts: t.contracts ?? 0,
      translation: snapshotOf(t),
      tradeId: null,
      outcome: null,
      lesson: '',
      createdAt: now,
      updatedAt: now,
    };
    const trade = mode === 'live' && ctx.account ? buildCopiedTrade(copy, ctx.account.id, ctx.account.balance, uuid()) : null;
    if (mode === 'live' && !trade) {
      setSaving(false);
      return setError('This copy cannot be logged as live — check the size and prices.');
    }
    logCopy(copy, trade);
    router.replace({ pathname: '/copy/[id]', params: { id: copy.id } });
  };

  const pickShot = async () => {
    const r = await pickImages('library', 1);
    if (r.status === 'ok' && r.images[0]) setShot(r.images[0].uri);
    else if (r.status === 'error') setError(r.message);
  };

  return (
    <Screen
      header={<AppHeader title="Log Copy Trade" subtitle="Sized to your account — never executed" back />}
      footer={
        <>
          {liveBlocked && t ? (
            <AppText variant="caption" tone="warning" align="center">
              {t.verdict === 'review' ? 'Fill in what’s missing to take it live — or log it as missed.' : 'Not allowed live — log it as missed or simulated to keep score.'}
            </AppText>
          ) : null}
          <Button label={mode === 'live' ? `Log live copy${t?.contracts ? ` · ${t.contracts} ${instrument}` : ''}` : `Log as ${MODE_LABEL[mode].toLowerCase()}`} icon="checkmark-done" disabled={!ready} onPress={save} />
        </>
      }>
      <View style={styles.gap}>
        <AppText variant="label">Copying</AppText>
        <View style={styles.chips}>
          {choices.map((x) => (
            <Chip key={x.id} label={x.name} icon="person-outline" selected={traderId === x.id} onPress={() => setTraderId(x.id)} />
          ))}
        </View>
        {trader ? (
          <AppText variant="caption" tone="tertiary">
            {SIZING_LABEL[trader.settings.sizingMode]}
            {trader.settings.sizingMode === 'fixed_risk' && trader.settings.fixedRisk ? ` $${trader.settings.fixedRisk}` : ''}
            {trader.settings.sizingMode === 'percent_risk' && trader.settings.percentRisk ? ` ${trader.settings.percentRisk}%` : ''}
            {trader.settings.sizingMode === 'scale' && trader.settings.scale ? ` ${trader.settings.scale.source}→${trader.settings.scale.mine}` : ''}
            {ctx?.account ? ` · checked against ${ctx.account.name}` : ''} ·{' '}
            <AppText variant="caption" tone="accent" onPress={() => router.push({ pathname: '/copy/trader/[id]', params: { id: trader.id } })}>
              Copy settings
            </AppText>
          </AppText>
        ) : null}
      </View>

      <View style={styles.gap}>
        <AppText variant="label">Instrument</AppText>
        <View style={styles.chips}>
          {options.map((o) => (
            <Chip key={o.value} label={o.label} selected={instrument === o.value} onPress={() => setInstrument(o.value)} />
          ))}
        </View>
      </View>
      <SegmentedControl
        options={[
          { value: 'long', label: 'Long', tone: 'positive' },
          { value: 'short', label: 'Short', tone: 'danger' },
        ]}
        value={direction}
        onChange={setDirection}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Entry" value={entry} onChangeText={setEntry} placeholder="0.00" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Stop" value={stop} onChangeText={setStop} placeholder="0.00" />
        </View>
        <View style={styles.flex}>
          <NumericInput label="Target" value={target} onChangeText={setTarget} placeholder="opt." />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <NumericInput label="Their size" value={srcContracts} onChangeText={setSrcContracts} placeholder="opt." suffix="ct" />
        </View>
        <View style={[styles.flex, styles.gap]}>
          <AppText variant="label">Of</AppText>
          <View style={styles.chips}>
            {pairs.map((p) => (
              <Chip key={p} label={p} selected={(srcInstrument ?? instrument) === p} onPress={() => setSrcInstrument(p)} />
            ))}
          </View>
        </View>
      </View>

      {t ? <CopyVerdictCard t={t} sourceLine={trader ? `from ${trader.name}` : null} /> : null}
      {needsConfirm && canTake ? (
        <ToggleRow label={`I confirm ${t!.contracts} ${instrument} (${'$' + Math.round(t!.riskDollars ?? 0)} risk)`} description="Required by your copy settings or a warning above." value={confirmed} onChange={setConfirmed} />
      ) : null}

      <SegmentedControl label="This copy was" options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} value={mode} onChange={setMode} />
      <View style={styles.gap}>
        <AppText variant="label">Your conviction</AppText>
        <View style={styles.chips}>
          {CONVICTION.map((c) => (
            <Chip key={c} label={c} selected={conviction === c} onPress={() => setConviction(conviction === c ? null : c)} />
          ))}
        </View>
      </View>

      <SectionHeader title="Details (optional)" />
      <Input label="Setup / reason" value={setup} onChangeText={setSetup} placeholder="e.g. ORB retest" maxLength={80} />
      <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="What the trader said, your read…" multiline maxLength={1000} />
      {shot ? (
        <View style={styles.shot}>
          <Image source={{ uri: shot }} style={styles.shotImg} contentFit="cover" accessibilityLabel="Copy screenshot" />
          <Pressable accessibilityRole="button" accessibilityLabel="Remove screenshot" onPress={() => setShot(null)} style={styles.shotX} hitSlop={8}>
            <Icon name="close" size={14} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <Button label="Add screenshot" icon="image-outline" variant="secondary" size="md" onPress={() => void pickShot()} />
      )}
      {!accounts.length ? (
        <Card tone="warning">
          <AppText variant="caption">Complete your account setup to validate copy-trade risk.</AppText>
          <Button label="Add account" variant="secondary" size="md" onPress={() => router.push('/accounts/new')} style={styles.mt} />
        </Card>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  mt: { marginTop: spacing.sm },
  shot: { width: 120, height: 80, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  shotImg: { width: '100%', height: '100%' },
  shotX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});
