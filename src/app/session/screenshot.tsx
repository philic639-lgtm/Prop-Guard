import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ProGate } from '@/components/domain/ProGate';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  ErrorState,
  LoadingState,
  NumericInput,
  Screen,
  SegmentedControl,
  StatusBadge,
  ToggleRow,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { newDraft } from '@/features/session/draft';
import { useActiveStrategy } from '@/hooks/useAppData';
import { INSTRUMENT_SYMBOLS } from '@/lib/engines';
import { aiService, type ScreenshotExtraction } from '@/services/ai';
import { pickScreenshot, type PreparedScreenshot } from '@/services/screenshotService';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { numToInput } from '@/utils/format';

type Phase = 'idle' | 'analyzing' | 'review' | 'error';

export default function ScreenshotScreen() {
  const strategy = useActiveStrategy();
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [image, setImage] = useState<PreparedScreenshot | null>(null);
  const [result, setResult] = useState<ScreenshotExtraction | null>(null);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const pick = async (source: 'library' | 'camera') => {
    const r = await pickScreenshot(source);
    if (r.status === 'cancelled') return;
    if (r.status === 'denied') {
      setError(source === 'camera' ? 'Camera access is required. Enable it in Settings.' : 'Photo access is required. Enable it in Settings.');
      setPhase('error');
      return;
    }
    if (r.status === 'error') {
      setError(r.message);
      setPhase('error');
      return;
    }
    setImage(r.image);
    setPhase('analyzing');
    setConfirmed(false);
    try {
      const x = await aiService.analyzeScreenshot({ imageBase64: r.image.base64, mimeType: r.image.mimeType });
      setResult(x);
      if (x.instrument) setInstrument(x.instrument);
      setDirection(x.direction);
      setEntry(numToInput(x.entry));
      setStop(numToInput(x.stop));
      setTarget(numToInput(x.target));
      setPhase('review');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const useValues = () => {
    const base = draft ?? newDraft(strategy, instrument);
    setDraft({
      ...base,
      instrument,
      direction: direction ?? base.direction,
      entry,
      stop,
      target,
      source: 'screenshot',
      screenshotUri: image?.uri ?? null,
    });
    router.replace('/session');
  };

  return (
    <Screen
      header={<AppHeader title="Analyze setup" back />}
      footer={
        phase === 'review' ? (
          <Button label="Use confirmed values" icon="checkmark-done" disabled={!confirmed || !direction} onPress={useValues} />
        ) : undefined
      }>
      <ProGate feature="screenshotAnalysis" title="Screenshot analysis" description="Upload a TradingView, Tradovate or NinjaTrader screenshot and extract the trade plan.">
        {phase === 'idle' ? (
          <>
            <Card>
              <View style={styles.drop}>
                <Ionicons name="image-outline" size={34} color={colors.accent} />
                <AppText variant="heading">Upload a chart screenshot</AppText>
                <AppText variant="caption" align="center">
                  Supported: TradingView · Tradovate · NinjaTrader · any chart screenshot
                </AppText>
              </View>
              <View style={styles.row}>
                <Button label="Photo library" icon="images-outline" size="md" style={styles.flex} onPress={() => void pick('library')} />
                <Button label="Camera" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
              </View>
            </Card>
            <Card>
              <AppText variant="label">How it works</AppText>
              <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
                Prop Guard identifies the instrument, direction, entry, stop, target and visible levels where possible. You confirm every value before anything is calculated — extracted numbers are never trusted silently.
              </AppText>
            </Card>
          </>
        ) : null}

        {phase === 'analyzing' ? (
          <Card>
            {image ? <Image source={{ uri: image.uri }} style={styles.preview} contentFit="contain" /> : null}
            <LoadingState label="Reading chart…" />
          </Card>
        ) : null}

        {phase === 'error' ? <ErrorState message={error} onRetry={() => setPhase('idle')} /> : null}

        {phase === 'review' && result ? (
          <>
            {image ? <Image source={{ uri: image.uri }} style={styles.preview} contentFit="contain" accessibilityLabel="Uploaded screenshot" /> : null}
            <Card tone={result.confidence === 'high' ? 'accent' : 'warning'}>
              <View style={styles.row}>
                <StatusBadge label={`${result.confidence} confidence`} tone={result.confidence === 'high' ? 'accent' : 'warning'} icon="scan" />
              </View>
              <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
                {result.notes}
              </AppText>
              {result.levels.length > 0 ? (
                <View style={styles.levels}>
                  {result.levels.map((l) => (
                    <StatusBadge key={`${l.label}${l.price}`} label={`${l.label} ${l.price}`} tone="neutral" size="sm" />
                  ))}
                </View>
              ) : null}
              <View style={styles.levels}>
                {result.detected.orb ? <StatusBadge label="ORB" tone="accent" size="sm" /> : null}
                {result.detected.vwap ? <StatusBadge label="VWAP" tone="accent" size="sm" /> : null}
                {result.detected.supportResistance ? <StatusBadge label="S/R" tone="accent" size="sm" /> : null}
              </View>
            </Card>

            <AppText variant="label">Detected — confirm every value</AppText>
            <SegmentedControl label="Instrument" options={INSTRUMENT_SYMBOLS.map((s) => ({ value: s, label: s }))} value={instrument} onChange={(v) => { setInstrument(v); setConfirmed(false); }} />
            <SegmentedControl
              label="Direction"
              options={[
                { value: 'long', label: 'Long', tone: 'positive' },
                { value: 'short', label: 'Short', tone: 'danger' },
              ]}
              value={direction}
              onChange={(v) => { setDirection(v); setConfirmed(false); }}
            />
            <NumericInput label="Entry" value={entry} onChangeText={(t) => { setEntry(t); setConfirmed(false); }} large placeholder="Enter price" />
            <View style={styles.row}>
              <View style={styles.flex}>
                <NumericInput label="Stop" value={stop} onChangeText={(t) => { setStop(t); setConfirmed(false); }} large />
              </View>
              <View style={styles.flex}>
                <NumericInput label="Target" value={target} onChangeText={(t) => { setTarget(t); setConfirmed(false); }} large />
              </View>
            </View>
            <Card>
              <ToggleRow
                label="I've checked these values"
                description="Extracted values can be wrong. Confirm they match your chart."
                value={confirmed}
                onChange={setConfirmed}
              />
            </Card>
            <Button label="Choose a different screenshot" variant="ghost" onPress={() => setPhase('idle')} />
          </>
        ) : null}
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  drop: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  flex: { flex: 1 },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
