import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors } from '@/constants/theme';

interface LineChartProps {
  data: number[];
  height?: number;
  color?: string;
  /** Horizontal reference line (e.g. starting balance or drawdown floor). */
  baseline?: number | null;
  accessibilityLabel?: string;
}

/** Lightweight SVG area chart — no native chart dependency required. */
export function LineChart({ data, height = 160, color = colors.accent, baseline, accessibilityLabel }: LineChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const values = data.length === 1 ? [data[0], data[0]] : data;
  const all = baseline != null ? [...values, baseline] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 8;
  const h = height - pad * 2;
  const x = (i: number) => (values.length <= 1 ? 0 : (i / (values.length - 1)) * width);
  const y = (v: number) => pad + h - ((v - min) / span) * h;

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <View onLayout={onLayout} style={{ height }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {width > 0 && values.length > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {baseline != null ? (
            <Line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke={colors.borderStrong} strokeDasharray="4 6" strokeWidth={1} />
          ) : null}
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
