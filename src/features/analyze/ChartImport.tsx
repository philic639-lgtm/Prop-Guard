import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  ErrorState,
  FieldRow,
  LoadingState,
  SegmentedControl,
  SelectField,
  StatusBadge,
  ToggleRow,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { instrumentOptions } from '@/lib/engines';
import { aiService, type ScreenshotExtraction } from '@/services/ai';
import { pickScreenshot } from '@/services/screenshotService';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { numToInput } from '@/utils/format';

export interface ConfirmedChartValues {
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: string;
  stop: string;
  target: string;
  imageUri: string | null;
}

type Phase = 'idle' | 'analyzing' | 'review' | 'error';

export const SUPPORTED_PLATFORMS = ['TradingView', 'Tradovate', 'NinjaTrader', 'Rithmic', 'Any chart'];

/**
 * Upload → AI extraction → user confirmation. Extracted values are NEVER
 * used until the trader confirms them.
 */
export function ChartImport({ onUse, cta = 'Use confirmed values' }: { onUse: (v: ConfirmedChartValues) => void; cta?: string }) {
  const demo = useAppStore((s) => s.mode === 'demo');
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const markets = useAppStore((s) => s.preferences.markets);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<ScreenshotExtraction | null>(null);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const analyze = async (base64: string, mimeType: 'image/jpeg' | 'image/png', uri: string | null) => {
    setImageUri(uri);
    setPhase('analyzing');
    setConfirmed(false);
    try {
      const x = await aiService.analyzeScreenshot({ imageBase64: base64, mimeType, demo });
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

  const pick = async (source: 'library' | 'camera') => {
    const r = await pickScreenshot(source);
    if (r.status === 'cancelled') return;
    if (r.status === 'denied') {
      setError(source === 'camera' ? 'Camera access is required. Enable it in Settings.' : 'Photo access is required. Enable it in Settings.');
      return setPhase('error');
    }
    if (r.status === 'error') {
      setError(r.message);
      return setPhase('error');
    }
    await analyze(r.image.base64, r.image.mimeType, r.image.uri);
  };

  const reset = () => setConfirmed(false);

  if (phase === 'analyzing') {
    return (
      <Card>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} contentFit="contain" /> : null}
        <LoadingState label="Reading chart — instrument, levels, entry, stop, target…" />
      </Card>
    );
  }
  if (phase === 'error') return <ErrorState message={error} onRetry={() => setPhase('idle')} />;

  if (phase === 'review' && result) {
    return (
      <View style={styles.gap}>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} contentFit="contain" accessibilityLabel="Uploaded screenshot" /> : null}
        <Card tone={result.confidence === 'high' ? 'accent' : 'warning'}>
          <StatusBadge label={`${result.confidence} confidence`} tone={result.confidence === 'high' ? 'accent' : 'warning'} icon="scan" />
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
        </Card>
        <Card>
          <AppText variant="label" style={{ marginBottom: spacing.sm }}>
            Detected — confirm every value
          </AppText>
          <FieldRow
            label="Instrument"
            control={
              <SelectField
                label="Instrument"
                value={instrument}
                options={instrumentOptions(markets)}
                onChange={(v) => {
                  setInstrument(v);
                  reset();
                }}
              />
            }
          />
          <FieldRow
            label="Direction"
            control={
              <SegmentedControl
                options={[
                  { value: 'long', label: 'Long', tone: 'positive' },
                  { value: 'short', label: 'Short', tone: 'danger' },
                ]}
                value={direction}
                onChange={(v) => {
                  setDirection(v);
                  reset();
                }}
              />
            }
          />
          <FieldRow label="Entry" value={entry} onChangeText={(t) => { setEntry(t); reset(); }} placeholder="Price" />
          <FieldRow label="Stop" value={stop} onChangeText={(t) => { setStop(t); reset(); }} placeholder="Price" />
          <FieldRow label="Target" value={target} onChangeText={(t) => { setTarget(t); reset(); }} placeholder="Price" />
          <ToggleRow label="I've checked these values" description="Extracted values can be wrong. Confirm they match your chart." value={confirmed} onChange={setConfirmed} />
        </Card>
        <Button
          label={cta}
          icon="checkmark-done"
          disabled={!confirmed || !direction || !entry || !stop}
          onPress={() => onUse({ instrument, direction: direction!, entry, stop, target, imageUri })}
        />
        <Button label="Choose a different screenshot" variant="ghost" onPress={() => setPhase('idle')} />
      </View>
    );
  }

  return (
    <View style={styles.gap}>
      <Card>
        <View style={styles.drop}>
          <View style={styles.dropIcon}>
            <Ionicons name="camera" size={30} color={colors.accentBright} />
          </View>
          <AppText variant="heading">Upload chart</AppText>
          <AppText variant="caption" align="center">
            Take a photo or upload a screenshot of your chart. Include the timeframe and price scale.
          </AppText>
        </View>
        <View style={styles.row}>
          <Button label="Upload" icon="images-outline" size="md" style={styles.flex} onPress={() => void pick('library')} />
          <Button label="Camera" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
        </View>
        {demo ? <Button label="Try a sample chart (demo)" variant="ghost" size="md" onPress={() => void analyze('', 'image/jpeg', null)} /> : null}
      </Card>
      <AppText variant="label">Supported platforms</AppText>
      <View style={styles.levels}>
        {SUPPORTED_PLATFORMS.map((p) => (
          <StatusBadge key={p} label={p} tone="neutral" size="sm" />
        ))}
      </View>
      <Card>
        <View style={styles.row}>
          <Ionicons name="information-circle" size={18} color={colors.accentBright} />
          <AppText variant="caption" style={styles.flex}>
            Prop Guard reads instrument, direction, entry, stop, target, ORB, VWAP and key levels where visible. You confirm every value — extracted numbers are never trusted silently.
          </AppText>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  flex: { flex: 1 },
  drop: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent + '88',
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    backgroundColor: '#0B1730',
  },
  dropIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
