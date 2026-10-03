import { StyleSheet, View } from 'react-native';

import { colors, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

export interface DetailRow {
  label: string;
  value: string;
  tone?: Tone | 'primary';
  bold?: boolean;
}

/** Label / value rows (Trade Details, Trade Plan, calculator results). */
export function DetailTable({ rows, title }: { rows: DetailRow[]; title?: string }) {
  return (
    <View>
      {title ? (
        <AppText variant="heading" style={styles.title}>
          {title}
        </AppText>
      ) : null}
      {rows.map((r, i) => (
        <View key={`${r.label}${i}`} style={[styles.row, i > 0 && styles.border]} accessible accessibilityLabel={`${r.label}: ${r.value}`}>
          <AppText variant="body" tone="secondary" style={styles.label}>
            {r.label}
          </AppText>
          <AppText
            variant="body"
            style={[
              styles.value,
              r.bold && { fontWeight: '700' },
              r.tone && r.tone !== 'primary' ? { color: toneColor[r.tone].fg, fontWeight: '700' } : null,
            ]}>
            {r.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, gap: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { flexShrink: 1 },
  value: { fontVariant: ['tabular-nums'], textAlign: 'right', fontWeight: '600' },
});
