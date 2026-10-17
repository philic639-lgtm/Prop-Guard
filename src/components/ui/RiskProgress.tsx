import { StyleSheet, View } from 'react-native';

import { colors, radius, toneColor, type Tone } from '@/constants/theme';

interface RiskProgressProps {
  /** 0..1 */
  value: number;
  tone?: Tone;
  height?: number;
  label?: string;
}

/** Tone defaults: under 60% neutral-accent, 60–90% warning, 90%+ danger. */
export function riskTone(value: number): Tone {
  if (value >= 0.9) return 'danger';
  if (value >= 0.6) return 'warning';
  return 'accent';
}

export function RiskProgress({ value, tone, height = 8, label }: RiskProgressProps) {
  const v = Math.max(0, Math.min(1, value));
  const t = tone ?? riskTone(v);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={[styles.track, { height, borderRadius: height }]}>
      <View style={[styles.fill, { width: `${v * 100}%`, backgroundColor: toneColor[t].fg, borderRadius: height }]}>
        {/* Soft highlight on the leading edge — reads as a premium meter, not a flat bar. */}
        {v > 0.04 ? <View style={[styles.sheen, { borderRadius: height }]} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', backgroundColor: colors.surface, overflow: 'hidden', borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  fill: { height: '100%', overflow: 'hidden' },
  sheen: { position: 'absolute', top: 0, bottom: '50%', left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.18)' },
});
