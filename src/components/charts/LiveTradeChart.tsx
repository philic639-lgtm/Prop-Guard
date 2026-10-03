import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';

interface LiveTradeChartProps {
  prices: number[];
  entry: number;
  stop: number;
  target: number | null;
  height?: number;
}

/** Price path with entry / stop / target levels (mockup "Live Trade Monitor"). */
export function LiveTradeChart({ prices, entry, stop, target, height = 220 }: LiveTradeChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const labelW = 64;
  const plotW = Math.max(0, width - labelW);
  const levels = [entry, stop, ...(target != null ? [target] : [])];
  const all = [...prices, ...levels];
  const pad = (Math.max(...all) - Math.min(...all)) * 0.12 || 1;
  const min = Math.min(...all) - pad;
  const max = Math.max(...all) + pad;
  const y = (v: number) => ((max - v) / (max - min)) * height;
  const x = (i: number) => (prices.length <= 1 ? 0 : (i / (prices.length - 1)) * plotW);
  const path = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = prices[prices.length - 1];
  const up = last >= entry;

  const level = (v: number, color: string, label: string) => (
    <>
      <Line x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke={color} strokeWidth={1.2} strokeDasharray="5 5" />
      <Rect x={plotW + 4} y={y(v) - 10} width={labelW - 6} height={20} rx={5} fill={color + '33'} stroke={color} strokeWidth={1} />
      <SvgText x={plotW + 4 + (labelW - 6) / 2} y={y(v) + 4} fontSize={10} fontWeight="700" fontFamily="Helvetica, Arial, sans-serif" fill={colors.text} textAnchor="middle">
        {label}
      </SvgText>
    </>
  );

  return (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Price chart. Entry ${entry}, stop ${stop}${target != null ? `, target ${target}` : ''}, current ${last}`}>
      {width > 0 && prices.length > 0 ? (
        <Svg width={width} height={height}>
          {target != null ? level(target, colors.positive, `T ${target.toFixed(2)}`) : null}
          {level(entry, colors.accentBright, `E ${entry.toFixed(2)}`)}
          {level(stop, colors.danger, `S ${stop.toFixed(2)}`)}
          <Path d={path} stroke={up ? colors.positive : colors.danger} strokeWidth={2.25} fill="none" strokeLinejoin="round" />
          <Circle cx={x(prices.length - 1)} cy={y(last)} r={4.5} fill={up ? colors.positive : colors.danger} stroke={colors.bg} strokeWidth={2} />
        </Svg>
      ) : null}
    </View>
  );
}
