import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, ErrorState, HeaderIconButton, Input, LoadingState, NumericInput, Screen, SegmentedControl, SelectField, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { SAMPLE_CHART_JPEG_BASE64 } from '@/features/setupCheck/sampleChart';
import { SetupCheckResult } from '@/features/setupCheck/SetupCheckResult';
import { useSetupRiskContext } from '@/features/setupCheck/useSetupRiskContext';
import { useActiveAccount, useActiveStrategy } from '@/hooks/useAppData';
import { instrumentOptions } from '@/lib/engines';
import { hasCheckableRules } from '@/lib/engines/setupValidation';
import { pickScreenshot } from '@/services/screenshotService';
import { analyzeSetup, SetupCheckError, setupCheckIsSimulated } from '@/services/setupCheck/SetupAnalysisService';
import { useAppStore } from '@/store/useAppStore';
import type { SetupCheck } from '@/types/domain';
import { numToInput, parseNum } from '@/utils/format';

type Phase = 'form' | 'analyzing' | 'result' | 'error';
type Shot = { base64: string; mimeType: string; uri: string | null; sample?: boolean };

const TIMEFRAMES = ['1m', '2m', '3m', '5m', '15m', '30m', '1h', '4h', 'D'] as const;

/**
 * AI Setup Check: does what is visible in this chart satisfy MY saved rules
 * and risk limits right now? QUALIFIED / WAIT / STAND DOWN is decided by
 * Prop Guard's deterministic engine — the AI only reports evidence per rule.
 */
export default function SetupCheckScreen() {
  const params = useLocalSearchParams<{ strategyId?: string }>();
  const strategies = useAppStore((s) => s.strategies);
  const markets = useAppStore((s) => s.preferences.markets);
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const demo = useAppStore((s) => s.mode === 'demo');
  const saveSetupCheck = useAppStore((s) => s.saveSetupCheck);
  const setDraft = useAppStore((s) => s.setDraft);
  const account = useActiveAccount();
  const active = useActiveStrategy();
  const risk = useSetupRiskContext();

  const [strategyId, setStrategyId] = useState<string | null>(params.strategyId ?? active?.id ?? null);
  const strategy = strategies.find((s) => s.id === strategyId) ?? null;
  const [instrument, setInstrument] = useState<string>(strategy?.markets[0] ?? defaultInstrument);
  const [timeframe, setTimeframe] = useState<string | null>(null);
  const [direction, setDirection] = useState<'long' | 'short' | 'unsure'>('unsure');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [contracts, setContracts] = useState('');
  const [notes, setNotes] = useState('');
  const [shot, setShot] = useState<Shot | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<SetupCheckError | null>(null);
  const [check, setCheck] = useState<SetupCheck | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  const strategyOptions = useMemo(() => strategies.map((s) => ({ value: s.id, label: s.name, sub: `${s.markets.join(', ') || 'Any market'} · ${s.timeframe}` })), [strategies]);
  const instruments = useMemo(() => instrumentOptions([...(strategy?.markets ?? []), ...markets]), [strategy, markets]);
  const simulated = setupCheckIsSimulated();
  const checkable = strategy ? hasCheckableRules(strategy) : false;

  if (!strategies.length) {
    return (
      <Screen header={<AppHeader title="Setup check" back />}>
        <EmptyState icon="list-outline" title="Save a strategy first" message="Setup Check compares a chart with YOUR saved rules, so it needs at least one strategy." actionLabel="Add a strategy" onAction={() => router.push('/strategy')} />
      </Screen>
    );
  }

  const pick = async (source: 'library' | 'camera') => {
    setPickError(null);
    const r = await pickScreenshot(source);
    if (r.status === 'ok') setShot({ base64: r.image.base64, mimeType: r.image.mimeType, uri: r.image.uri });
    else if (r.status === 'denied') setPickError(source === 'camera' ? 'Camera access was denied. Allow it in Settings or upload a screenshot instead.' : 'Photo access was denied. Allow it in Settings to upload a chart.');
    else if (r.status === 'error') setPickError('That image could not be opened. Try another screenshot.');
  };

  const run = async () => {
    setPhase('analyzing');
    setError(null);
    try {
      const result = await analyzeSetup({
        strategy,
        image: shot,
        input: { instrument, timeframe, direction, entry: parseNum(entry), stop: parseNum(stop), target: parseNum(target), contracts: parseNum(contracts), notes },
        risk,
        accountId: account?.id ?? null,
      });
      setCheck(result);
      setPhase('result');
    } catch (e) {
      setError(e instanceof SetupCheckError ? e : new SetupCheckError('unavailable', (e as Error).message));
      setPhase('error');
    }
  };

  const save = () => {
    if (!check) return;
    saveSetupCheck(check);
    setCheck({ ...check, saved: true });
  };

  /** Hand the checked plan to Check Trade — the trade will be linked to this Setup Check. */
  const useInCheckTrade = () => {
    if (!check || !strategy) return;
    if (!check.saved) saveSetupCheck(check);
    const d = newDraft(strategy, check.instrument);
    setDraft({
      ...d,
      direction: check.direction === 'short' ? 'short' : 'long',
      entry: numToInput(check.risk.entry),
      stop: numToInput(check.risk.stop),
      target: numToInput(check.risk.target),
      contracts: check.risk.contracts ? String(check.risk.contracts) : d.contracts,
      screenshotUri: check.screenshotUri,
      notes: check.notes,
      setupCheckId: check.id,
    });
    router.push('/analyze');
  };

  const reset = () => {
    setCheck(null);
    setPhase('form');
  };

  return (
    <Screen
      header={<AppHeader title="Setup check" subtitle="Chart vs your saved rules" back right={<HeaderIconButton icon="time-outline" label="Saved setup checks" onPress={() => router.push('/setup-check/history')} />} />}
      footer={
        phase === 'form' ? (
          <Button label="Check this setup" icon="scan-outline" disabled={!strategy || !shot || !checkable} onPress={run} />
        ) : phase === 'result' && check ? (
          <View style={{ gap: spacing.sm }}>
            <Button label={check.saved ? 'Setup check saved' : 'Save Setup Check'} icon={check.saved ? 'checkmark' : 'bookmark-outline'} disabled={check.saved} onPress={save} />
            <View style={styles.row}>
              <Button label="New check" icon="refresh" variant="secondary" size="md" style={styles.flex} onPress={reset} />
              <Button label="Plan in Check Trade" icon="shield-checkmark-outline" variant="secondary" size="md" style={styles.flex} onPress={useInCheckTrade} />
            </View>
          </View>
        ) : undefined
      }>
      {phase === 'analyzing' ? <LoadingState label="Comparing the chart with your saved rules…" /> : null}

      {phase === 'error' && error ? (
        <>
          <ErrorState message={error.message} onRetry={error.retry ? run : undefined} />
          <Button label="Back to setup" variant="ghost" onPress={() => setPhase('form')} />
        </>
      ) : null}

      {phase === 'result' && check ? <SetupCheckResult check={check} /> : null}

      {phase === 'form' ? (
        <>
          <Card>
            <AppText variant="body">
              Upload your chart and Prop Guard checks whether what is visible satisfies <AppText variant="bodyStrong">your saved rules</AppText> and risk limits right now — 🟢 QUALIFIED, 🟡 WAIT or 🔴 STAND DOWN. It checks rule compliance; it never predicts a winner.
            </AppText>
            {simulated ? (
              <View style={{ marginTop: spacing.sm }}>
                <StatusBadge label="Demo mode — chart reading is simulated" tone="warning" icon="flask-outline" size="sm" />
              </View>
            ) : null}
          </Card>

          <SelectField label="Strategy" value={strategyId} options={strategyOptions} onChange={(id) => {
            setStrategyId(id);
            const s = strategies.find((x) => x.id === id);
            if (s?.markets[0]) setInstrument(s.markets[0]);
          }} placeholder="Choose a saved strategy" icon="list-outline" />
          {strategy && !checkable ? (
            <AppText variant="caption" tone="warning">
              This strategy has no rules Prop Guard can check on a chart. Add checklist items or entry / confirmation rules to it first.
            </AppText>
          ) : null}
          <SelectField label="Instrument" value={instrument} options={instruments} onChange={setInstrument} icon="stats-chart-outline" />

          <Card>
            <AppText variant="label">Chart screenshot</AppText>
            {shot ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <Image source={{ uri: shot.uri ?? `data:${shot.mimeType};base64,${shot.base64}` }} style={styles.preview} contentFit="contain" accessibilityLabel="Selected chart screenshot" />
                {shot.sample ? <StatusBadge label="Sample chart — not market data" tone="warning" size="sm" /> : null}
                <Button label="Replace screenshot" icon="images-outline" variant="ghost" size="md" onPress={() => void pick('library')} />
              </View>
            ) : (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={styles.row}>
                  <Button label="Upload" icon="images-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('library')} />
                  <Button label="Camera" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
                </View>
                {demo || simulated ? (
                  <Button label="Use a sample chart (demo)" variant="ghost" size="md" onPress={() => setShot({ base64: SAMPLE_CHART_JPEG_BASE64, mimeType: 'image/jpeg', uri: null, sample: true })} />
                ) : null}
                <AppText variant="caption">JPEG, PNG or WebP up to 4 MB. Include the levels your rules mention (e.g. the opening range) and the timeframe label.</AppText>
              </View>
            )}
            {pickError ? (
              <AppText variant="caption" tone="danger" style={{ marginTop: spacing.xs }}>
                {pickError}
              </AppText>
            ) : null}
          </Card>

          <AppText variant="label">Optional details</AppText>
          <SegmentedControl
            label="Direction you’re considering"
            options={[
              { value: 'long', label: 'Long' },
              { value: 'short', label: 'Short' },
              { value: 'unsure', label: 'Unsure' },
            ]}
            value={direction}
            onChange={setDirection}
          />
          <SelectField label="Timeframe" value={timeframe} options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={setTimeframe} placeholder="Not specified" icon="time-outline" />
          <View style={styles.row}>
            <View style={styles.flex}>
              <NumericInput label="Entry" value={entry} onChangeText={setEntry} placeholder="—" />
            </View>
            <View style={styles.flex}>
              <NumericInput label="Stop" value={stop} onChangeText={setStop} placeholder="—" />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <NumericInput label="Target" value={target} onChangeText={setTarget} placeholder="—" />
            </View>
            <View style={styles.flex}>
              <NumericInput label="Contracts" value={contracts} onChangeText={setContracts} placeholder="—" />
            </View>
          </View>
          <Input label="Notes" value={notes} onChangeText={setNotes} placeholder="e.g. 1H trend is up" multiline maxLength={240} />
          <View style={styles.hint}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textTertiary} />
            <AppText variant="caption" tone="tertiary" style={styles.flex}>
              The screenshot is analysed server-side and only stored if you save the check. Text inside the image is treated as chart content, never as instructions.
            </AppText>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0 },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  hint: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
});
