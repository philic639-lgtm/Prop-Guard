import { useState } from 'react';
import { Platform, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors } from '@/constants/theme';
import type { VisualChart } from '@/data/strategyLibrary';

interface VisualDiagramProps {
  chart: VisualChart;
  height?: number;
  /** Reward:risk shown on the target label. */
  rr?: number;
  accessibilityLabel?: string;
}

// SVG text defaults to a serif face on web; match the app's sans-serif UI font.
const FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;
const LABEL_W = 92;
const MAX_LABEL = 15;
const short = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const PAD_Y = 16;
const LABEL_GAP = 13;

type RightLabel = { y: number; text: string; color: string };

/** Spread right-gutter labels so close levels (e.g. stop just under the level) never overlap. */
function spreadLabels(labels: RightLabel[], height: number): RightLabel[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + LABEL_GAP };
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - (height - 6) : 0;
  if (overflow > 0) for (let i = sorted.length - 1; i >= 0; i--) sorted[i] = { ...sorted[i], y: sorted[i].y - overflow };
  return sorted;
}

/**
 * Simplified, annotated candlestick diagram for strategy education.
 * Renders any VisualChart: candles, levels/curves, zones, numbered stages,
 * entry / stop area / target area, and a "don't enter here" marker.
 */
export function VisualDiagram({ chart, height = 240, rr, accessibilityLabel }: VisualDiagramProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotW = Math.max(0, width - LABEL_W);
  const n = chart.candles.length;
  const slot = n ? plotW / n : 0;
  const t = chart.trade;

  const values = [
    ...chart.candles.flatMap((k) => [k.h, k.l]),
    ...chart.lines.flatMap((l) => (l.values ?? (l.value != null ? [l.value] : []))),
    ...(chart.zones ?? []).flatMap((z) => [z.top, z.bottom]),
    ...(t ? [t.stop, t.target, t.entry] : []),
  ];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.06 || 1;
  const min = lo - pad;
  const max = hi + pad;
  const y = (v: number) => PAD_Y + ((max - v) / (max - min)) * (height - PAD_Y * 2);
  const cx = (i: number) => i * slot + slot / 2;
  const bodyW = Math.max(3, slot * 0.56);

  const right: RightLabel[] = [];
  chart.lines.forEach((l) => {
    const v = l.values ? l.values[Math.min(l.values.length, n) - 1] : l.value;
    if (v != null) right.push({ y: y(v), text: l.label, color: colors.accentBright });
  });
  if (t) {
    right.push({ y: y(t.entry), text: 'Entry', color: colors.text });
    right.push({ y: y(t.stop), text: 'Stop', color: colors.danger });
    right.push({ y: y(t.target), text: rr ? `Target 1:${rr}` : 'Target', color: colors.positive });
  }
  const labels = spreadLabels(right, height);

  return (
    <View onLayout={onLayout} style={{ height }} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* Zones such as the opening range */}
          {(chart.zones ?? []).map((z) => (
            <G key={z.label}>
              <Rect
                x={z.from * slot}
                y={y(z.top)}
                width={(z.to - z.from + 1) * slot}
                height={Math.max(1, y(z.bottom) - y(z.top))}
                fill={colors.accent}
                opacity={0.1}
                stroke={colors.accent}
                strokeOpacity={0.35}
                strokeDasharray="3 3"
              />
              <SvgText fontFamily={FONT} x={z.from * slot + 4} y={y(z.bottom) - 4} fill={colors.accentBright} fontSize={9} fontWeight="600">
                {z.label}
              </SvgText>
            </G>
          ))}

          {/* Risk (stop) and reward (target) areas from the entry onward */}
          {t ? (
            <G>
              <Rect x={cx(t.entryCandle)} y={Math.min(y(t.entry), y(t.stop))} width={plotW - cx(t.entryCandle)} height={Math.abs(y(t.stop) - y(t.entry))} fill={colors.danger} opacity={0.16} />
              <Rect x={cx(t.entryCandle)} y={Math.min(y(t.entry), y(t.target))} width={plotW - cx(t.entryCandle)} height={Math.abs(y(t.target) - y(t.entry))} fill={colors.positive} opacity={0.13} />
              <Line x1={cx(t.entryCandle)} x2={plotW} y1={y(t.stop)} y2={y(t.stop)} stroke={colors.danger} strokeWidth={1.2} />
              <Line x1={cx(t.entryCandle)} x2={plotW} y1={y(t.target)} y2={y(t.target)} stroke={colors.positive} strokeWidth={1.2} />
              <Line x1={cx(t.entryCandle)} x2={plotW} y1={y(t.entry)} y2={y(t.entry)} stroke={colors.text} strokeWidth={1.2} strokeDasharray="5 3" />
            </G>
          ) : null}

          {/* Levels and moving lines */}
          {chart.lines.map((l) =>
            l.values ? (
              <Path
                key={l.label}
                d={l.values
                  .slice(0, n)
                  .map((v, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`)
                  .join(' ')}
                stroke={colors.accentBright}
                strokeWidth={1.8}
                fill="none"
              />
            ) : l.value != null ? (
              <Line key={l.label} x1={0} x2={plotW} y1={y(l.value)} y2={y(l.value)} stroke={colors.accentBright} strokeWidth={1.4} strokeDasharray="6 4" />
            ) : null,
          )}

          {/* Candles */}
          {chart.candles.map((k, i) => {
            const up = k.c >= k.o;
            const col = up ? colors.positive : colors.danger;
            const top = y(Math.max(k.o, k.c));
            return (
              <G key={i}>
                <Line x1={cx(i)} x2={cx(i)} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth={1.4} />
                <Rect x={cx(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1.5, y(Math.min(k.o, k.c)) - top)} fill={col} rx={1.5} />
              </G>
            );
          })}

          {/* Entry marker */}
          {t ? (
            <G>
              {/* Arrow pointing at the entry price, just right of the entry candle */}
              <Path d={`M${cx(t.entryCandle) + bodyW / 2 + 3},${y(t.entry)} l9,-6 l0,12 z`} fill={colors.accent} />
            </G>
          ) : null}

          {/* Numbered stages */}
          {(chart.stages ?? []).map((s) => {
            const k = chart.candles[s.candle];
            if (!k) return null;
            const raw = s.at === 'high' ? y(k.h) - 13 : y(k.l) + 13;
            const sy = Math.min(height - 10, Math.max(10, raw));
            return (
              <G key={s.step}>
                <Circle cx={cx(s.candle)} cy={sy} r={9} fill={colors.accent} stroke={colors.bg} strokeWidth={1.5} />
                <SvgText fontFamily={FONT} x={cx(s.candle)} y={sy + 3.5} fill={colors.accentOn} fontSize={10.5} fontWeight="700" textAnchor="middle">
                  {String(s.step)}
                </SvgText>
              </G>
            );
          })}

          {/* "Not valid" marker on common-mistake charts */}
          {chart.mistake
            ? (() => {
                const m = chart.mistake;
                const mx = cx(m.candle) + bodyW / 2 + 12;
                const my = y(m.price);
                // Label sits above the marker, kept inside the plot.
                const lx = Math.min(Math.max(mx, 40), plotW - 40);
                return (
                  <G>
                    <Circle cx={mx} cy={my} r={9} fill={colors.danger} />
                    <Path d={`M${mx - 4},${my - 4} L${mx + 4},${my + 4} M${mx + 4},${my - 4} L${mx - 4},${my + 4}`} stroke={colors.accentOn} strokeWidth={2} />
                    <SvgText fontFamily={FONT} x={lx} y={Math.max(10, my - 14)} fill={colors.danger} fontSize={10} fontWeight="700" textAnchor="middle">
                      {m.label}
                    </SvgText>
                  </G>
                );
              })()
            : null}

          {/* Right-gutter labels */}
          {labels.map((l) => (
            <SvgText fontFamily={FONT} key={l.text} x={plotW + 6} y={l.y + 3.5} fill={l.color} fontSize={10} fontWeight="600">
              {short(l.text)}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
