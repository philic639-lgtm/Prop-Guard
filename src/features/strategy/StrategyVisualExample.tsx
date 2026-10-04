import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { VisualDiagram } from '@/components/charts/VisualDiagram';
import { AppText, Card, StatusBadge, TabSwitch } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import type { RealChartExample, VisualExample } from '@/data/strategyLibrary';

type Tab = 'diagram' | 'real';

interface StrategyVisualExampleProps {
  visual: VisualExample;
  strategyName: string;
}

/**
 * Beginner-friendly visual example for a strategy: a numbered 5-stage diagram,
 * a slot for real historical chart examples, "why this entry works" and a
 * "common mistake" counter-example. Everything comes from the template's
 * `visual` config, so any strategy can supply its own.
 */
export function StrategyVisualExample({ visual, strategyName }: StrategyVisualExampleProps) {
  const [tab, setTab] = useState<Tab>('diagram');
  const d = visual.diagram;
  const risk = Math.abs(d.trade.entry - d.trade.stop);
  const reward = Math.abs(d.trade.target - d.trade.entry);
  const describe = `${strategyName} example: ${d.stages.map((s) => `${s.step}. ${s.title}`).join(', ')}.`;

  return (
    <View style={styles.wrap}>
      <TabSwitch
        options={[
          { value: 'diagram', label: 'Simple Diagram' },
          { value: 'real', label: 'Real Chart Example' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'diagram' ? (
        <Card>
          <View style={styles.badges}>
            <StatusBadge label={visual.direction === 'long' ? 'Long example' : 'Short example'} tone={visual.direction === 'long' ? 'positive' : 'danger'} icon={visual.direction === 'long' ? 'arrow-up' : 'arrow-down'} size="sm" />
            <StatusBadge label={`1:${visual.rr} risk / reward`} tone="accent" size="sm" />
            <StatusBadge label="Illustration" size="sm" />
          </View>

          <View style={styles.chart}>
            <VisualDiagram chart={d} rr={visual.rr} accessibilityLabel={describe} />
          </View>

          <View style={styles.legend}>
            <Legend color={colors.accentBright} label={d.lines.map((l) => l.label).join(' · ') || 'Structure'} dashed />
            <Legend color={colors.danger} label="Stop-loss area" />
            <Legend color={colors.positive} label="Take-profit area" />
          </View>

          <View style={styles.rr}>
            <Metric label="Risk" value="1R" tone={colors.danger} />
            <Metric label="Reward" value={`${(reward / risk).toFixed(1).replace('.0', '')}R`} tone={colors.positive} />
            <Metric label="Example R:R" value={`1:${visual.rr}`} tone={colors.accentBright} />
          </View>

          <View style={styles.stages}>
            {d.stages.map((s) => (
              <View key={s.step} style={styles.stage}>
                <View style={styles.num}>
                  <AppText variant="caption" style={styles.numText}>
                    {s.step}
                  </AppText>
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong">{s.title}</AppText>
                  <AppText variant="caption">{s.detail}</AppText>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : (
        <RealExamples examples={visual.realExamples} strategyName={strategyName} />
      )}

      <Card tone="positive">
        <View style={styles.head}>
          <Ionicons name="checkmark-circle" size={18} color={colors.positive} />
          <AppText variant="label" tone="positive">
            Why this entry works
          </AppText>
        </View>
        <AppText variant="caption" style={{ marginTop: spacing.xs }}>
          Every rule of the plan is satisfied before the entry:
        </AppText>
        {visual.whyItWorks.map((w) => (
          <View key={w} style={styles.line}>
            <Ionicons name="checkmark" size={15} color={colors.positive} />
            <AppText variant="body" style={styles.flex}>
              {w}
            </AppText>
          </View>
        ))}
      </Card>

      <Card tone="danger">
        <View style={styles.head}>
          <Ionicons name="close-circle" size={18} color={colors.danger} />
          <AppText variant="label" tone="danger" style={styles.flex}>
            Common mistake
          </AppText>
          <StatusBadge label="Not a valid setup" tone="danger" size="sm" />
        </View>
        <AppText variant="bodyStrong" style={{ marginTop: spacing.sm }}>
          {visual.mistake.title}
        </AppText>
        <View style={styles.chart}>
          <VisualDiagram chart={visual.mistake.chart} height={170} accessibilityLabel={`Common mistake: ${visual.mistake.title}`} />
        </View>
        <AppText variant="body" tone="secondary">
          {visual.mistake.explanation}
        </AppText>
      </Card>
    </View>
  );
}

function RealExamples({ examples, strategyName }: { examples: RealChartExample[]; strategyName: string }) {
  if (examples.length === 0) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="images-outline" size={28} color={colors.accentBright} />
        <AppText variant="heading" align="center">
          Real chart examples coming soon
        </AppText>
        <AppText variant="caption" align="center">
          Annotated historical charts of {strategyName} will appear here — each showing the instrument, date and timeframe, marked with the same five stages as the diagram.
        </AppText>
        <AppText variant="caption" tone="tertiary" align="center">
          Until then, use the Simple Diagram tab or practice the setup on your own screenshots.
        </AppText>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.md }}>
      {examples.map((ex) => (
        <Card key={`${ex.instrument}${ex.date}${ex.caption}`}>
          <Image source={typeof ex.image === 'string' ? { uri: ex.image } : ex.image} style={styles.realImage} contentFit="contain" accessibilityLabel={`${ex.instrument} ${ex.timeframe} chart, ${ex.date}`} />
          <View style={[styles.badges, { marginTop: spacing.md }]}>
            <StatusBadge label={ex.instrument} size="sm" />
            <StatusBadge label={ex.timeframe} size="sm" />
            <StatusBadge label={ex.date} size="sm" />
          </View>
          <AppText variant="body" style={{ marginTop: spacing.sm }}>
            {ex.caption}
          </AppText>
          {(ex.notes ?? []).map((n, i) => (
            <AppText key={n} variant="caption" style={{ marginTop: 4 }}>
              {i + 1}. {n}
            </AppText>
          ))}
        </Card>
      ))}
    </View>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: dashed ? 'transparent' : color + '55', borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      <AppText variant="caption" style={{ fontSize: 11.5 }} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={styles.metric}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ color: tone }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chart: { marginVertical: spacing.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  swatch: { width: 14, height: 10, borderRadius: 2, borderWidth: 1 },
  rr: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  metric: { flex: 1, gap: 2 },
  stages: { marginTop: spacing.lg, gap: spacing.md },
  stage: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  numText: { color: colors.accentOn, fontWeight: '700', fontSize: 11.5 },
  line: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  placeholder: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accent + '88',
    backgroundColor: '#0B1730',
  },
  realImage: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.md, backgroundColor: colors.surface },
});
