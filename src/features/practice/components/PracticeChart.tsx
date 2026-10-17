import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { CHART_FONT, spreadLabels, type RightLabel } from '@/components/charts/VisualDiagram';
import { colors } from '@/constants/theme';
import { formatPrice } from '@/lib/engines/instrumentEngine';
import { etParts } from '@/lib/engines/marketTime';
import type { PracticeScenario } from '@/types/practice';

export interface ChartTradeLines {
  entry: number;
  stop: number;
  target: number;
}

interface PracticeChartProps {
  scenario: PracticeScenario;
  /** Number of candles revealed (decisionIndex + 1 before the decision). */
  visibleCount: number;
  user?: ChartTradeLines | null;
  ideal?: ChartTradeLines | null;
  /** Candle index where the user's trade exited (marker). */
  exitIndex?: number | null;
  height?: number;
}

const GUTTER = 104;
const SHORT: Record<string, string> = {
  'Previous day high': 'PDH',
  'Previous day low': 'PDL',
  'Prior swing high': 'Swing H',
  'Prior swing low': 'Swing L',
  'Swing high': 'Swing H',
  'Swing low': 'Swing L',
  Resistance: 'Res',
  Support: 'Sup',
};
const PAD_TOP = 14;
const AXIS_H = 18;

/**
 * Candlestick replay chart. Only `visibleCount` candles are drawn — the
 * price scale is computed from visible data and structural levels only, so
 * nothing about the hidden future leaks before the decision.
 */
export function PracticeChart({ scenario: s, visibleCount, user, ideal, exitIndex, height = 280 }: PracticeChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const total = s.candles.length;
  const visible = s.candles.slice(0, visibleCount);
  const plotW = Math.max(0, width - GUTTER);
  const plotH = height - PAD_TOP - AXIS_H;
  const slot = total ? plotW / total : 0;
  const bodyW = Math.max(3, slot * 0.58);
  const cx = (i: number) => i * slot + slot / 2;

  const vwap = s.vwap?.slice(0, visibleCount) ?? [];
  const values = [
    ...visible.flatMap((k) => [k.high, k.low]),
    ...s.levels.map((l) => l.price),
    ...vwap,
    ...(user ? [user.entry, user.stop, user.target] : []),
    ...(ideal ? [ideal.entry, ideal.stop, ideal.target] : []),
  ];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.07 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH;
  const p = (v: number) => formatPrice(s.instrument, v);

  const labels: RightLabel[] = [];
  s.levels.forEach((l) => labels.push({ y: y(l.price), text: `${SHORT[l.label] ?? l.label} ${p(l.price)}`, color: colors.accentBright }));
  if (vwap.length) labels.push({ y: y(vwap[vwap.length - 1]), text: `VWAP ${p(vwap[vwap.length - 1])}`, color: colors.warning });
  if (user) {
    labels.push({ y: y(user.entry), text: `Entry ${p(user.entry)}`, color: colors.text });
    labels.push({ y: y(user.stop), text: `Stop ${p(user.stop)}`, color: colors.danger });
    labels.push({ y: y(user.target), text: `Target ${p(user.target)}`, color: colors.positive });
  }
  if (ideal) labels.push({ y: y(ideal.entry), text: `Ideal ${p(ideal.entry)}`, color: colors.accentBright });
  const last = visible[visible.length - 1];
  if (last) labels.push({ y: y(last.close), text: p(last.close), color: colors.textSecondary });
  const placed = spreadLabels(labels, PAD_TOP + plotH);

  const decisionX = cx(s.decisionIndex) + slot / 2;
  const hiddenFrom = visibleCount * slot;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  // Historical bars are UTC; show exchange (ET) time. Sample timestamps are already local session times.
  const timeLabel = (i: number) => {
    const ts = s.candles[i]?.timestamp;
    if (!ts) return '';
    return s.historical ? hhmm(etParts(ts).minutes) : ts.slice(11, 16);
  };
  // Decision time first so it wins when labels would collide; drop any label within 36px of a kept one.
  const axisIdx = [s.decisionIndex, 0, total - 1, Math.floor(total / 2)]
    .filter((i) => i < visibleCount)
    .reduce<number[]>((kept, i) => (kept.every((k) => Math.abs(cx(k) - cx(i)) >= 36) ? [...kept, i] : kept), []);
  const or = s.openingRange;

  return (
    <View
      onLayout={onLayout}
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${s.instrument} ${s.timeframe ?? '5m'} chart, ${visibleCount} of ${total} candles shown`}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* Opening range box */}
          {or && or.to < visibleCount ? (
            <Rect x={or.from * slot} y={y(or.high)} width={(or.to - or.from + 1) * slot} height={Math.max(1, y(or.low) - y(or.high))} fill={colors.accent} opacity={0.1} />
          ) : null}

          {/* Structural levels */}
          {s.levels.map((l) => (
            <Line key={l.label} x1={0} x2={plotW} y1={y(l.price)} y2={y(l.price)} stroke={colors.accentBright} strokeWidth={1.2} strokeDasharray="6 4" opacity={0.85} />
          ))}
          {vwap.length > 1 ? (
            <Path d={vwap.map((v, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} stroke={colors.warning} strokeWidth={1.6} fill="none" opacity={0.9} />
          ) : null}

          {/* Hidden future */}
          {visibleCount < total ? (
            <G>
              <Rect x={hiddenFrom} y={PAD_TOP} width={plotW - hiddenFrom} height={plotH} fill={colors.surface} opacity={0.65} />
              <SvgText fontFamily={CHART_FONT} x={hiddenFrom + (plotW - hiddenFrom) / 2} y={PAD_TOP + plotH / 2} fill={colors.textTertiary} fontSize={11} fontWeight="600" textAnchor="middle">
                {visibleCount <= s.decisionIndex + 1 ? 'Future hidden' : ''}
              </SvgText>
            </G>
          ) : null}

          {/* Ideal trade (after the exercise) */}
          {ideal ? (
            <G opacity={0.9}>
              {[
                { v: ideal.entry, c: colors.accentBright },
                { v: ideal.stop, c: colors.danger },
                { v: ideal.target, c: colors.positive },
              ].map((l) => (
                <Line key={`ideal${l.v}${l.c}`} x1={decisionX} x2={plotW} y1={y(l.v)} y2={y(l.v)} stroke={l.c} strokeWidth={1} strokeDasharray="2 3" />
              ))}
            </G>
          ) : null}

          {/* User trade */}
          {user ? (
            <G>
              <Rect x={decisionX} y={Math.min(y(user.entry), y(user.stop))} width={plotW - decisionX} height={Math.abs(y(user.stop) - y(user.entry))} fill={colors.danger} opacity={0.12} />
              <Rect x={decisionX} y={Math.min(y(user.entry), y(user.target))} width={plotW - decisionX} height={Math.abs(y(user.target) - y(user.entry))} fill={colors.positive} opacity={0.1} />
              <Line x1={decisionX} x2={plotW} y1={y(user.stop)} y2={y(user.stop)} stroke={colors.danger} strokeWidth={1.3} />
              <Line x1={decisionX} x2={plotW} y1={y(user.target)} y2={y(user.target)} stroke={colors.positive} strokeWidth={1.3} />
              <Line x1={decisionX} x2={plotW} y1={y(user.entry)} y2={y(user.entry)} stroke={colors.text} strokeWidth={1.3} strokeDasharray="5 3" />
            </G>
          ) : null}

          {/* Decision point */}
          <Line x1={decisionX} x2={decisionX} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke={colors.accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />

          {/* Candles */}
          {visible.map((k, i) => {
            const up = k.close >= k.open;
            const col = up ? colors.positive : colors.danger;
            const top = y(Math.max(k.open, k.close));
            return (
              <G key={k.timestamp}>
                <Line x1={cx(i)} x2={cx(i)} y1={y(k.high)} y2={y(k.low)} stroke={col} strokeWidth={1.3} />
                <Rect x={cx(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1.5, y(Math.min(k.open, k.close)) - top)} fill={col} rx={1} opacity={i > s.decisionIndex ? 0.95 : 1} />
              </G>
            );
          })}

          {/* Exit marker */}
          {exitIndex != null && exitIndex < visibleCount && user ? (
            <Circle cx={cx(exitIndex)} cy={y(s.candles[exitIndex].close)} r={5} fill="none" stroke={colors.text} strokeWidth={2} />
          ) : null}

          {/* Time axis */}
          {axisIdx.map((i) => (
            <SvgText key={`t${i}`} fontFamily={CHART_FONT} x={Math.min(Math.max(cx(i), 16), plotW - 16)} y={height - 4} fill={colors.textTertiary} fontSize={9.5} textAnchor="middle">
              {timeLabel(i)}
            </SvgText>
          ))}

          {/* Right-gutter labels */}
          {placed.map((l) => (
            <SvgText key={l.text} fontFamily={CHART_FONT} x={plotW + 6} y={l.y + 3.5} fill={l.color} fontSize={9.5} fontWeight="600">
              {l.text}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
