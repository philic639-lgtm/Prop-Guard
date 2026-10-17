import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

interface CircularScoreProps {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  label?: string;
  suffix?: string;
  /** Custom center content (replaces the numeric value). */
  children?: ReactNode;
}

export function CircularScore({ value, max = 100, size = 132, stroke = 10, tone = 'accent', label, suffix, children }: CircularScoreProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const color = toneColor[tone].fg;
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label ?? 'Score'} ${Math.round(value)}${suffix ?? ''}`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        {children ?? (
        <>
        <AppText variant={size >= 120 ? 'display' : 'number'} style={size < 80 ? { fontSize: 16 } : undefined}>
          {Math.round(value)}
          {suffix ? <AppText variant="number" tone="secondary" style={{ fontSize: size >= 120 ? 18 : 12 }}>{suffix}</AppText> : null}
        </AppText>
        {label && size >= 100 ? (
          <AppText variant="label" style={{ fontSize: 10 }}>
            {label}
          </AppText>
        ) : null}
        </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
