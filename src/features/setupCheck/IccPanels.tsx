import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { Decision, IccManual, IccObservation, IccOverlayKey, IccSummary, SetupDisplayStatus } from '@/lib/engines/setupCheck';

import { DECISION_UI } from './SetupCheckResult';
import { STATUS_UI } from './SetupDecisionCard';

/**
 * ICC (Indication → Correction → Continuation) panels for Setup Check.
 * Everything shown here is computed by the shared ICC logic (icc.ts); these
 * components only display it or collect the trader's explicit stage choices.
 */

const word = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Not confirmed');
const num = (n: number | null | undefined) => (n == null ? null : n.toLocaleString('en-US', { maximumFractionDigits: 4 }));

type Option<T extends string> = { value: T; label: string; tone?: 'positive' | 'warning' | 'danger' };
const TONE = { positive: colors.positive, warning: colors.warning, danger: colors.danger };

/** Single-choice chips; nothing pre-selected, tap the selected chip again to clear. */
export function OptionChips<T extends string>({ label, value, options, onChange }: { label: string; value: T | undefined; options: Option<T>[]; onChange: (v: T | null) => void }) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = value === o.value;
        const c = TONE[o.tone ?? 'positive'];
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${label}: ${o.label}`} onPress={() => onChange(on ? null : o.value)} style={[styles.chip, on && { borderColor: c, backgroundColor: `${c}22` }]}>
            <AppText variant="caption" style={{ color: on ? c : colors.textSecondary, fontWeight: '700' }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const QUALITY: Option<'STRONG' | 'MODERATE' | 'WEAK'>[] = [
  { value: 'STRONG', label: 'Strong' },
  { value: 'MODERATE', label: 'Moderate', tone: 'warning' },
  { value: 'WEAK', label: 'Weak', tone: 'danger' },
];

function ChartReading({ stage, obs }: { stage: string | null; obs: IccSummary['observation'] }) {
  if (!obs || !stage) return null;
  return (
    <AppText variant="caption" tone={obs.counted ? 'secondary' : 'warning'} style={{ marginTop: 4 }}>
      {obs.source === 'demo' ? 'DEMO — simulated, not counted' : obs.counted ? 'Chart analysis' : 'Chart analysis (low confidence — not counted)'}: {stage}
    </AppText>
  );
}

/**
 * The trader's stage confirmations. Each choice replaces the chart reading for
 * that stage; nothing is pre-selected. Direction comes from the trade side.
 */
export function IccStagePanel({ manual, onChange, icc, onUseLevels }: { manual: IccManual; onChange: <K extends keyof IccManual>(key: K, value: IccManual[K] | null) => void; icc: IccSummary | null; onUseLevels?: () => void }) {
  const obs = icc?.observation ?? null;
  const d = obs?.data;
  return (
    <Card>
      <AppText variant="label">ICC stages — Indication · Correction · Continuation</AppText>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Confirm only what has already happened on your chart. Nothing is pre-selected; a stage you don’t confirm stays unconfirmed. Your choice replaces the chart reading for that stage.
      </AppText>

      <View style={styles.stage}>
        <AppText variant="bodyStrong">Higher-timeframe bias (Daily / 4H / 1H)</AppText>
        <OptionChips label="Higher-timeframe bias" value={manual.htfBias} onChange={(v) => onChange('htfBias', v)} options={[{ value: 'BULLISH', label: 'Bullish' }, { value: 'BEARISH', label: 'Bearish' }, { value: 'NEUTRAL', label: 'Neutral / unclear', tone: 'warning' }]} />
        <ChartReading stage={d ? `${word(d.htfBias)}${d.htfReason ? ` — ${d.htfReason}` : ''}` : null} obs={obs} />
      </View>

      <View style={styles.stage}>
        <AppText variant="bodyStrong">1 — Indication</AppText>
        <AppText variant="caption">A meaningful swing broken with a candle BODY close beyond it and clear displacement. Not an entry by itself.</AppText>
        <OptionChips label="Indication" value={manual.indication} onChange={(v) => onChange('indication', v)} options={[{ value: 'CONFIRMED', label: 'Confirmed' }, { value: 'WEAK', label: 'Weak', tone: 'warning' }, { value: 'NOT_PRESENT', label: 'Not present', tone: 'danger' }]} />
        {manual.indication === 'CONFIRMED' ? <OptionChips label="Indication displacement" value={manual.displacement} onChange={(v) => onChange('displacement', v)} options={QUALITY} /> : null}
        <ChartReading stage={d ? `${word(d.indication.status)}${d.indication.direction ? ` · ${word(d.indication.direction)}` : ''}${d.indication.swingLevel != null ? ` · swing ~${num(d.indication.swingLevel)}` : ''}${d.indication.reason ? ` — ${d.indication.reason}` : ''}` : null} obs={obs} />
      </View>

      <View style={styles.stage}>
        <AppText variant="bodyStrong">2 — Correction</AppText>
        <AppText variant="caption">A pullback against the indication that keeps its structure intact. Random chop is not a correction.</AppText>
        <OptionChips
          label="Correction"
          value={manual.correction}
          onChange={(v) => onChange('correction', v)}
          options={[
            { value: 'CONFIRMED', label: 'Confirmed' },
            { value: 'DEVELOPING', label: 'Developing', tone: 'warning' },
            { value: 'TOO_SHALLOW', label: 'Too shallow', tone: 'warning' },
            { value: 'TOO_DEEP', label: 'Too deep', tone: 'warning' },
            { value: 'INVALIDATED', label: 'Invalidated', tone: 'danger' },
            { value: 'NOT_PRESENT', label: 'Not present', tone: 'danger' },
          ]}
        />
        <ChartReading stage={d ? `${word(d.correction.status)}${d.correction.zoneLow != null || d.correction.zoneHigh != null ? ` · zone ${num(d.correction.zoneLow) ?? '?'}–${num(d.correction.zoneHigh) ?? '?'}` : ''}${d.correction.reason ? ` — ${d.correction.reason}` : ''}` : null} obs={obs} />
      </View>

      <View style={styles.stage}>
        <AppText variant="bodyStrong">3 — Continuation</AppText>
        <AppText variant="caption">Price reclaims short-term structure in the indication direction and a candle CLOSES with confirmation.</AppText>
        <OptionChips label="Continuation" value={manual.continuation} onChange={(v) => onChange('continuation', v)} options={[{ value: 'CONFIRMED', label: 'Confirmed' }, { value: 'DEVELOPING', label: 'Developing', tone: 'warning' }, { value: 'NOT_CONFIRMED', label: 'Not confirmed', tone: 'warning' }, { value: 'FAILED', label: 'Failed', tone: 'danger' }]} />
        {manual.continuation === 'CONFIRMED' ? <OptionChips label="Continuation momentum" value={manual.momentum} onChange={(v) => onChange('momentum', v)} options={QUALITY} /> : null}
        <ChartReading stage={d ? `${word(d.continuation.status)}${d.continuation.level != null ? ` · level ~${num(d.continuation.level)}` : ''}${d.continuation.reason ? ` — ${d.continuation.reason}` : ''}` : null} obs={obs} />
      </View>

      <View style={styles.stage}>
        <AppText variant="bodyStrong">Room to TP1</AppText>
        <AppText variant="caption">Is the path to your first structural target clear of nearby opposing structure?</AppText>
        <OptionChips label="Room to TP1" value={manual.room} onChange={(v) => onChange('room', v)} options={[{ value: 'CLEAR', label: 'Clear' }, { value: 'LIMITED', label: 'Limited', tone: 'warning' }, { value: 'BLOCKED', label: 'Blocked', tone: 'danger' }]} />
      </View>

      {icc?.chartLevels && obs?.counted && onUseLevels ? (
        <View style={styles.stage}>
          <AppText variant="bodyStrong">Levels read from the chart</AppText>
          <AppText variant="caption">
            Entry {num(icc.chartLevels.entry) ?? '—'} · Stop {num(icc.chartLevels.stop) ?? '—'} · TP1 {num(icc.chartLevels.tp1) ?? '—'} · TP2 {num(icc.chartLevels.tp2) ?? '—'}. Check them against your chart before using them.
          </AppText>
          <Button label="Use these levels" icon="checkmark-done-outline" variant="secondary" size="md" onPress={onUseLevels} />
        </View>
      ) : null}
    </Card>
  );
}

const OVERLAY: { key: IccOverlayKey; label: string; color: string }[] = [
  { key: 'tp2', label: 'TP2', color: colors.positive },
  { key: 'tp1', label: 'TP1', color: colors.positive },
  { key: 'indication', label: 'INDICATION — swing break', color: colors.accentBright },
  { key: 'continuation', label: 'CONTINUATION — confirmation', color: colors.accentBright },
  { key: 'entry', label: 'ENTRY', color: colors.text },
  { key: 'stop', label: 'STOP — invalidation', color: colors.danger },
];

/** Screenshot with the ICC map drawn on it (approximate positions from the chart reading). */
export function IccChartOverlay({ uri, observation }: { uri: string; observation: { data: IccObservation; source: 'vision' | 'demo'; counted: boolean } }) {
  const [ratio, setRatio] = useState(16 / 9);
  const o = observation.data.overlay;
  const zoneTop = o.correctionTop != null && o.correctionBottom != null ? Math.min(o.correctionTop, o.correctionBottom) : null;
  const zoneBottom = o.correctionTop != null && o.correctionBottom != null ? Math.max(o.correctionTop, o.correctionBottom) : null;
  // Labels of lines that sit close together alternate sides so they stay readable.
  const lines = OVERLAY.filter((l) => o[l.key] != null)
    .sort((a, b) => o[a.key]! - o[b.key]!)
    .reduce<{ key: IccOverlayKey; label: string; color: string; left: boolean }[]>((acc, l) => {
      const prev = acc[acc.length - 1];
      acc.push({ ...l, left: !!prev && o[l.key]! - o[prev.key]! < 0.08 && !prev.left });
      return acc;
    }, []);
  if (!lines.length && zoneTop == null) return null;
  return (
    <View>
      <View style={[styles.overlayBox, { aspectRatio: ratio }]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="fill" accessibilityLabel="Chart screenshot with the ICC map" onLoad={(e) => e.source.width && e.source.height && setRatio(e.source.width / e.source.height)} />
        {zoneTop != null && zoneBottom != null ? (
          <View style={[styles.zone, { top: `${zoneTop * 100}%`, height: `${(zoneBottom - zoneTop) * 100}%` }]}>
            <AppText variant="caption" style={styles.zoneLabel}>
              CORRECTION
            </AppText>
          </View>
        ) : null}
        {lines.map((l) => (
          <View key={l.key} style={[styles.line, { top: `${o[l.key]! * 100}%`, borderColor: l.color }]}>
            <AppText variant="caption" style={[styles.lineLabel, l.left ? { left: 4, right: undefined } : null, { color: l.color }]}>
              {l.label}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone={observation.source === 'demo' ? 'warning' : 'tertiary'} style={{ marginTop: 4 }}>
        {observation.source === 'demo' ? 'DEMO — illustrative positions only; the chart was not read.' : 'Approximate positions from chart analysis — check them against your chart.'}
      </AppText>
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'warning' | 'danger' }) {
  return (
    <View style={styles.row}>
      <AppText variant="caption" style={styles.rowLabel}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={[styles.flex, tone ? { color: TONE[tone] } : null]}>
        {value}
      </AppText>
    </View>
  );
}

const stageTone = (v: string | null): 'positive' | 'warning' | 'danger' | undefined => (!v ? 'warning' : v === 'CONFIRMED' ? 'positive' : ['INVALIDATED', 'FAILED', 'NOT_PRESENT'].includes(v) ? 'danger' : 'warning');
const SOURCE = { vision: 'chart analysis', manual: 'you confirmed' } as const;
const checkTone = (v: string) => (v === 'PASS' ? 'positive' : v === 'FAIL' ? 'danger' : v === 'NOT_APPLICABLE' ? undefined : 'warning');

/** The ICC SETUP card — deterministic summary in the ICC report format. */
export function IccSetupCard({ icc, decision, riskCheck, propCompliance, screenshotUri, status }: { icc: IccSummary; decision: Decision; riskCheck: string; propCompliance: string; screenshotUri?: string | null; /** Unified decision status — shown as the final decision when given. */ status?: SetupDisplayStatus }) {
  const ui = status ? { ...STATUS_UI[status], emoji: '' } : DECISION_UI[decision];
  const valid = icc.patternStatus === 'VALID ICC LONG' || icc.patternStatus === 'VALID ICC SHORT';
  const stage = (n: string, s: IccSummary['indication'] | IccSummary['correction'] | IccSummary['continuation'] | IccSummary['htf']) => (
    <View style={styles.stage}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.flex}>
          {n}
        </AppText>
        <StatusBadge label={word(s.value)} tone={stageTone(s.value) ?? 'neutral'} size="sm" />
        {s.source ? <StatusBadge label={SOURCE[s.source]} tone="neutral" size="sm" /> : null}
      </View>
      <AppText variant="caption" style={{ marginTop: 2 }}>
        Reason: {s.reason}
      </AppText>
    </View>
  );
  const level = (v: number | null, chart: number | null | undefined) => (v != null ? num(v)! : chart != null ? `${num(chart)} (chart — not confirmed)` : 'Not set');
  return (
    <Card>
      <AppText variant="label" tone="accent">
        ICC SETUP
      </AppText>
      {screenshotUri && icc.observation ? (
        <View style={{ marginTop: spacing.sm }}>
          <IccChartOverlay uri={screenshotUri} observation={icc.observation} />
        </View>
      ) : null}
      <View style={{ marginTop: spacing.sm, gap: 4 }}>
        <Row label="Direction" value={word(icc.direction)} />
        <Row label="Higher-timeframe bias" value={`${word(icc.htf.value)} — ${icc.htf.reason}`} tone={stageTone(icc.htf.value === 'NEUTRAL' ? 'DEVELOPING' : icc.htf.value ? (icc.htf.value === icc.direction ? 'CONFIRMED' : 'FAILED') : null)} />
      </View>
      {stage('1 — Indication', icc.indication)}
      {stage('2 — Correction', icc.correction)}
      {stage('3 — Continuation', icc.continuation)}

      <View style={styles.stage}>
        <Row label="ICC score" value={`${icc.score.total}/100 · ${icc.scoreLabel}`} tone={icc.score.total >= 70 ? 'positive' : icc.score.total >= 60 ? 'warning' : 'danger'} />
        {icc.score.parts.map((p) => (
          <AppText key={p.id} variant="caption">
            {p.label}: {p.points}/{p.max} — {p.note}
          </AppText>
        ))}
        <AppText variant="caption" tone="tertiary">
          Stage quality from confirmed evidence only — not a win probability. It never increases your risk.
        </AppText>
      </View>

      <View style={[styles.stage, { gap: 4 }]}>
        <Row label="Entry status" value={icc.entryStatus} tone={valid && !icc.entryStatus.startsWith('VALID SETUP') ? 'positive' : icc.patternStatus === 'ICC SETUP INVALIDATED' || icc.entryStatus.startsWith('VALID SETUP') ? 'danger' : 'warning'} />
        <AppText variant="caption">{icc.statusReason}</AppText>
        <Row label="Potential entry" value={level(icc.levels.entry, icc.chartLevels?.entry)} />
        <Row label="Invalidation / stop" value={level(icc.levels.stop, icc.chartLevels?.stop)} />
        <Row label="TP1" value={level(icc.levels.tp1, icc.chartLevels?.tp1)} />
        <Row label="TP2" value={level(icc.levels.tp2, icc.chartLevels?.tp2)} />
        <Row label="Estimated R:R" value={`${icc.rr.tp1 != null ? `TP1 ${icc.rr.tp1.toFixed(2)}R` : 'TP1 —'} · ${icc.rr.tp2 != null ? `TP2 ${icc.rr.tp2.toFixed(2)}R` : 'TP2 —'}`} />
        <Row label="Risk check" value={riskCheck} tone={checkTone(riskCheck)} />
        <Row label="Prop firm check" value={propCompliance === 'NOT_APPLICABLE' ? 'N/A' : propCompliance} tone={checkTone(propCompliance)} />
      </View>

      <View style={[styles.verdict, { borderColor: TONE[ui.tone] }]}>
        <AppText variant="caption">FINAL DECISION</AppText>
        <AppText variant="heading" style={{ color: TONE[ui.tone] }}>
          {ui.emoji ? `${ui.emoji} ` : ''}{ui.title}
        </AppText>
      </View>

      <View style={styles.stage}>
        <AppText variant="label">Why</AppText>
        {icc.why.map((w) => (
          <AppText key={w} variant="body">
            • {w}
          </AppText>
        ))}
      </View>
      <View style={styles.stage}>
        <AppText variant="label">What must happen next</AppText>
        <AppText variant="body">{icc.next}</AppText>
        {icc.chartNext ? (
          <AppText variant="caption" style={{ marginTop: 4 }}>
            From the chart reading: {icc.chartNext}
          </AppText>
        ) : null}
      </View>
      <View style={styles.stage}>
        {icc.happened.length ? <AppText variant="caption">✓ Already happened: {icc.happened.join(' ')}</AppText> : null}
        {icc.developing.length ? <AppText variant="caption">◐ Developing: {icc.developing.join(' ')}</AppText> : null}
        {icc.needed.length ? <AppText variant="caption">○ Still needs to happen: {icc.needed.join(' ')}</AppText> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stage: { paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flexWrap: 'wrap' },
  rowLabel: { width: 132 },
  flex: { flex: 1, minWidth: 120 },
  overlayBox: { width: '100%', borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  zone: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(245, 183, 11, 0.16)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(245, 183, 11, 0.5)' },
  zoneLabel: { color: colors.warning, fontWeight: '700', paddingHorizontal: 4 },
  line: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
  lineLabel: { position: 'absolute', right: 4, top: -16, fontWeight: '700', backgroundColor: colors.overlay, paddingHorizontal: 4, borderRadius: 4 },
  verdict: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1, borderRadius: radius.md, gap: 2 },
});
