import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

interface MetricTileProps {
  label: string;
  value: string;
  tone?: Tone | 'primary';
  sub?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  align?: 'left' | 'center';
  children?: ReactNode;
}

/** Boxed metric used in the dashboard grids (mockup style). */
export function MetricTile({ label, value, tone = 'primary', sub, icon, onPress, align = 'left', children }: MetricTileProps) {
  const color = tone === 'primary' ? colors.text : toneColor[tone].fg;
  const body = (
    <>
      <AppText variant="caption" style={[styles.label, align === 'center' && styles.center]} numberOfLines={1}>
        {label}
      </AppText>
      <View style={[styles.valueRow, align === 'center' && { justifyContent: 'center' }]}>
        {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
        <AppText variant="number" style={{ color, fontSize: 21 }} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </AppText>
      </View>
      {sub ? (
        <AppText variant="caption" tone="tertiary" style={align === 'center' ? styles.center : undefined} numberOfLines={1}>
          {sub}
        </AppText>
      ) : null}
      {children}
    </>
  );
  const a11y = `${label}: ${value}${sub ? `, ${sub}` : ''}`;
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View style={styles.tile} accessible accessibilityLabel={a11y}>
      {body}
    </View>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 76,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 4,
  },
  label: { color: colors.textSecondary, fontSize: 12.5 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  center: { textAlign: 'center' },
});
