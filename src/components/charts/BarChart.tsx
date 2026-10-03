import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/constants/theme';
import { money } from '@/utils/format';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

/** Horizontal diverging bars — readable on phones, labels never collide. */
export function BarChart({ data, format = money }: { data: BarDatum[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <View style={styles.list}>
      {data.map((d) => {
        const w = (Math.abs(d.value) / max) * 100;
        const pos = d.value >= 0;
        return (
          <View key={d.key} style={styles.row} accessible accessibilityLabel={`${d.label}: ${format(d.value)}`}>
            <AppText variant="caption" numberOfLines={1} style={styles.label}>
              {d.label}
            </AppText>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.max(2, w)}%`, backgroundColor: pos ? colors.positive : colors.danger }]} />
            </View>
            <AppText variant="caption" style={[styles.value, { color: pos ? colors.positive : colors.danger }]}>
              {pos && d.value > 0 ? '+' : ''}
              {format(d.value)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { width: 92, color: colors.textSecondary },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surface, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 5, opacity: 0.85 },
  value: { width: 72, textAlign: 'right', fontVariant: ['tabular-nums'], fontWeight: '600' },
});
