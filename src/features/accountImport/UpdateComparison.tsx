import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { ChangeRow } from '@/lib/engines/accountUpdate';
import { money } from '@/utils/format';

const show = (r: ChangeRow, v: ChangeRow['before']) =>
  v == null ? null : typeof v === 'number' ? (r.kind === 'percent' ? `${v}%` : money(v, { cents: Math.abs(v % 1) > 0.004, sign: r.kind === 'signed' })) : v;

/**
 * Saved values next to the values this update would save — computed with the same
 * engine that saves them. Unknown new values read "Needs verification", never 0.
 */
export function UpdateComparison({ rows, title = 'What changes' }: { rows: ChangeRow[]; title?: string }) {
  if (!rows.length) return null;
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <AppText variant="bodyStrong" style={styles.label}>
          {title}
        </AppText>
        <AppText variant="caption" tone="tertiary" style={styles.col}>
          Saved now
        </AppText>
        <AppText variant="caption" tone="tertiary" style={styles.col}>
          After update
        </AppText>
      </View>
      {rows.map((r) => {
        const before = show(r, r.before);
        const after = show(r, r.after);
        return (
          <View key={r.key} style={[styles.row, styles.line]} accessibilityLabel={`${r.label}: ${before ?? 'not known'} to ${after ?? 'needs verification'}`}>
            <AppText variant="caption" tone="secondary" style={styles.label}>
              {r.label}
            </AppText>
            <AppText variant="caption" tone="tertiary" style={styles.col}>
              {before ?? '—'}
            </AppText>
            <AppText variant="caption" style={[styles.col, r.changed && styles.changed, r.needsVerification && styles.verify]}>
              {after ?? 'Needs verification'}
            </AppText>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { flex: 1.3, minWidth: 0 },
  col: { flex: 1, minWidth: 0, textAlign: 'right' },
  changed: { color: colors.text, fontWeight: '700' },
  verify: { color: colors.warning },
});
