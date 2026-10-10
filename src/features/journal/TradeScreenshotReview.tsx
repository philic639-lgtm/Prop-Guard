import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DetailTable, FieldRow, LoadingState, SegmentedControl, SelectField, StatusBadge, ToggleRow } from '@/components/ui';
import { colors, radius, spacing, type Tone } from '@/constants/theme';
import { calculateTradeRisk, instrumentOptions, isInstrumentSymbol } from '@/lib/engines';
import { REVIEW_CONFIDENCE, type ReadField, type ScreenshotKind, type TradeReading } from '@/lib/engines/tradeScreenshot';
import { pickScreenshot } from '@/services/screenshotService';
import { readTradeScreenshot } from '@/services/tradeScreenshotService';
import { useAppStore } from '@/store/useAppStore';
import type { Direction, InstrumentSymbol } from '@/types/domain';
import { money, numToInput, parseNum, rr } from '@/utils/format';

/** Values the trader confirmed — the journal form is filled with exactly these. */
export interface ConfirmedTradeShot {
  instrument: InstrumentSymbol;
  direction: Direction;
  entry: string;
  exit: string;
  stop: string;
  target: string;
  contracts: number | null;
  imageUri: string | null;
  shownPnl: number | null;
  kind: ScreenshotKind;
}

const KIND: Record<ScreenshotKind, { label: string; tone: Tone }> = {
  completed_trade: { label: 'Completed trade', tone: 'positive' },
  open_position: { label: 'Open position', tone: 'warning' },
  pending_order: { label: 'Pending order (not filled)', tone: 'warning' },
  chart_only: { label: 'Chart only', tone: 'neutral' },
  account_dashboard: { label: 'Account dashboard', tone: 'neutral' },
  unsupported: { label: 'Not a trading screenshot', tone: 'danger' },
};
const SOURCE: Record<string, string> = {
  fill: 'fill',
  position: 'position',
  working_order: 'working order',
  position_tool: 'position tool',
  chart_drawing: 'chart drawing',
  text_note: 'text note',
  account_panel: 'account panel',
  not_visible: '',
};

function Confidence({ f }: { f: ReadField<unknown> }) {
  if (f.value == null) return <AppText variant="caption" tone="tertiary">Not visible</AppText>;
  const check = f.confidence < REVIEW_CONFIDENCE || f.flags.length > 0;
  return (
    <AppText variant="caption" style={{ color: check ? colors.warning : colors.positive }}>
      {check ? 'Check' : 'Clear'} · {SOURCE[f.source]}
    </AppText>
  );
}

function Evidence({ f }: { f: ReadField<unknown> }) {
  if (f.value == null && !f.flags.length) return null;
  return (
    <AppText variant="caption" tone={f.flags.length ? 'warning' : 'tertiary'} style={styles.evidence} numberOfLines={3}>
      {[f.evidence, ...f.flags].filter(Boolean).join(' · ')}
    </AppText>
  );
}

/**
 * Upload a trade screenshot → server reads it (OpenAI vision, structured
 * output) → the trader reviews and corrects every value → confirmed values
 * fill the journal form. Without the server, it says so and offers manual entry.
 */
export function TradeScreenshotReview({ onUse, onManual }: { onUse: (v: ConfirmedTradeShot) => void; onManual: () => void }) {
  const defaultInstrument = useAppStore((s) => s.preferences.defaultInstrument);
  const markets = useAppStore((s) => s.preferences.markets);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [reading, setReading] = useState<TradeReading | null>(null);
  const [instrument, setInstrument] = useState<InstrumentSymbol>(defaultInstrument);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [qty, setQty] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const pick = async (source: 'library' | 'camera') => {
    setMessage('');
    const r = await pickScreenshot(source);
    if (r.status === 'cancelled') return;
    if (r.status !== 'ok') {
      setMessage(r.status === 'denied' ? (source === 'camera' ? 'Camera access is needed to take a photo.' : 'Photo access is needed to choose a screenshot.') : r.message);
      return;
    }
    setImageUri(r.image.uri);
    setPhase('reading');
    setConfirmed(false);
    const res = await readTradeScreenshot({ base64: r.image.base64, mimeType: r.image.mimeType });
    if (res.status !== 'ok') {
      setMessage(res.message);
      setPhase('failed');
      return;
    }
    const x = res.reading;
    setReading(x);
    if (x.instrument.value && isInstrumentSymbol(x.instrument.value)) setInstrument(x.instrument.value);
    setDirection(x.direction.value);
    setEntry(numToInput(x.entryPrice.value));
    setExit(numToInput(x.exitPrice.value));
    setStop(numToInput(x.stopPrice.value));
    setTarget(numToInput(x.targetPrice.value));
    setQty(numToInput(x.quantity.value));
    setPhase('review');
  };

  if (phase === 'reading') return <LoadingState label="Reading your screenshot…" />;

  if (phase === 'idle' || phase === 'failed') {
    return (
      <Card style={styles.gap}>
        <View style={styles.drop}>
          <Ionicons name="scan-outline" size={30} color={colors.accentBright} />
          <AppText variant="heading" align="center">
            Upload a trade screenshot
          </AppText>
          <AppText variant="caption" align="center">
            Tradovate, TradingView, NinjaTrader… Prop Guard reads entry, exit, stop, target and size. You confirm every value before anything is saved.
          </AppText>
        </View>
        <View style={styles.row}>
          <Button label="Upload" icon="images-outline" size="md" style={styles.flex} onPress={() => void pick('library')} />
          <Button label="Camera" icon="camera-outline" variant="secondary" size="md" style={styles.flex} onPress={() => void pick('camera')} />
        </View>
        {message ? (
          <AppText variant="caption" tone={phase === 'failed' ? 'warning' : 'danger'}>
            {message}
          </AppText>
        ) : null}
        <Button label="Enter manually instead" variant="ghost" size="md" onPress={onManual} />
      </Card>
    );
  }

  const x = reading!;
  const e = parseNum(entry);
  const s = parseNum(stop);
  const t = parseNum(target);
  const q = parseNum(qty);
  const contracts = q != null && Number.isInteger(q) && q > 0 ? q : null;
  const risk = direction && e != null && s != null && contracts ? calculateTradeRisk({ instrument, direction, entry: e, stop: s, target: t, contracts }) : null;
  const canFill = (x.kind === 'completed_trade' || x.kind === 'open_position') && direction != null && e != null && confirmed;

  const row = (label: string, f: ReadField<unknown>, value: string, set: (v: string) => void) => (
    <View key={label}>
      <View style={styles.labelRow}>
        <AppText variant="caption" style={styles.flex}>
          {label}
        </AppText>
        <Confidence f={f} />
      </View>
      <FieldRow label={label} value={value} onChangeText={(v) => (setConfirmed(false), set(v))} placeholder="Not visible — enter if you know it" />
      <Evidence f={f} />
    </View>
  );

  return (
    <View style={styles.gap}>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} contentFit="contain" accessibilityLabel="Uploaded screenshot" /> : null}
      <Card style={styles.gap}>
        <View style={styles.row}>
          <StatusBadge label={KIND[x.kind].label} tone={KIND[x.kind].tone} size="sm" />
          {x.platform.value ? <StatusBadge label={x.platform.value} size="sm" /> : null}
        </View>
        {x.warnings.map((w) => (
          <AppText key={w} variant="caption" tone="warning">
            ⚠ {w}
          </AppText>
        ))}
        {x.notes ? (
          <AppText variant="caption" tone="tertiary">
            Reader note: {x.notes}
          </AppText>
        ) : null}
      </Card>

      <Card style={styles.gap}>
        <AppText variant="label">Check every value against your screenshot</AppText>
        <View style={styles.labelRow}>
          <AppText variant="caption" style={styles.flex}>
            Instrument{x.instrument.raw ? ` (shown: ${x.instrument.raw})` : ''}
          </AppText>
          <Confidence f={x.instrument} />
        </View>
        <SelectField label="Instrument" value={instrument} options={instrumentOptions(markets)} onChange={(v) => (setConfirmed(false), setInstrument(v))} />
        <View style={styles.labelRow}>
          <AppText variant="caption" style={styles.flex}>
            Direction
          </AppText>
          <Confidence f={x.direction} />
        </View>
        <SegmentedControl
          options={[
            { value: 'long', label: 'Long', tone: 'positive' },
            { value: 'short', label: 'Short', tone: 'danger' },
          ]}
          value={direction}
          onChange={(v) => (setConfirmed(false), setDirection(v))}
        />
        {row('Entry', x.entryPrice, entry, setEntry)}
        {row('Exit', x.exitPrice, exit, setExit)}
        {row('Stop', x.stopPrice, stop, setStop)}
        {row('Target', x.targetPrice, target, setTarget)}
        {row('Contracts', x.quantity, qty, setQty)}
      </Card>

      <DetailTable
        title="Risk (from the contract specs)"
        rows={[
          { label: 'Dollar risk at stop', value: risk?.valid ? money(risk.riskDollars, { cents: true }) : risk ? risk.errors[0] ?? '—' : 'Needs direction, entry, stop and contracts', tone: risk?.valid ? 'danger' : undefined },
          { label: 'Reward at target', value: risk?.valid && risk.rewardDollars != null ? money(risk.rewardDollars, { cents: true }) : '—', tone: 'positive' },
          { label: 'Reward : risk', value: risk?.valid && risk.rr != null ? rr(risk.rr) : '—', bold: true },
          ...(x.realizedPnl.value != null ? [{ label: 'Realized P&L shown on screenshot', value: money(x.realizedPnl.value, { sign: true, cents: true }) }] : []),
          ...(x.accountBalance.value != null ? [{ label: 'Account balance shown', value: money(x.accountBalance.value, { cents: true }) }] : []),
          ...(x.drawdown.value != null ? [{ label: 'Drawdown shown', value: money(x.drawdown.value, { cents: true }) }] : []),
        ]}
      />
      {x.levels.length ? (
        <Card style={styles.gap}>
          <AppText variant="label">Marked chart levels</AppText>
          {x.levels.map((l) => (
            <AppText key={`${l.label}${l.price}`} variant="caption">
              {l.label || 'Level'} · {l.price} <AppText variant="caption" tone="tertiary">({l.kind.replace('_', ' ')})</AppText>
            </AppText>
          ))}
        </Card>
      ) : null}

      <Card tone="accent" style={styles.gap}>
        <ToggleRow label="These values match my screenshot" value={confirmed} onChange={setConfirmed} />
        <Button
          label={x.kind === 'completed_trade' || x.kind === 'open_position' ? 'Fill journal entry' : 'Not a trade — enter manually'}
          icon="checkmark"
          disabled={x.kind === 'completed_trade' || x.kind === 'open_position' ? !canFill : false}
          onPress={() =>
            x.kind === 'completed_trade' || x.kind === 'open_position'
              ? onUse({ instrument, direction: direction!, entry, exit, stop, target, contracts, imageUri, shownPnl: x.realizedPnl.value, kind: x.kind })
              : onManual()
          }
        />
        <Button label="Use a different screenshot" variant="ghost" size="md" onPress={() => setPhase('idle')} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  drop: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent + '88', borderRadius: radius.md, backgroundColor: '#0B1730' },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.surface },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  evidence: { marginTop: 2 },
});
