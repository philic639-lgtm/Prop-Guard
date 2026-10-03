import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface ChecklistRow {
  id: string;
  label: string;
  state: 'pass' | 'fail' | 'warn' | 'pending';
  detail?: string;
}

const ICON: Record<ChecklistRow['state'], { name: keyof typeof Ionicons.glyphMap; color: string; a11y: string }> = {
  pass: { name: 'checkmark-circle', color: colors.positive, a11y: 'passed' },
  fail: { name: 'close-circle', color: colors.danger, a11y: 'failed' },
  warn: { name: 'alert-circle', color: colors.warning, a11y: 'caution' },
  pending: { name: 'ellipse-outline', color: colors.textTertiary, a11y: 'not checked' },
};

export function RuleChecklist({ rows }: { rows: ChecklistRow[] }) {
  return (
    <View style={styles.list}>
      {rows.map((r) => {
        const i = ICON[r.state];
        return (
          <View key={r.id} style={styles.row} accessible accessibilityLabel={`${r.label}, ${i.a11y}${r.detail ? `. ${r.detail}` : ''}`}>
            <Ionicons name={i.name} size={20} color={i.color} />
            <View style={styles.text}>
              <AppText variant="body" tone={r.state === 'pending' ? 'secondary' : 'primary'}>
                {r.label}
              </AppText>
              {r.detail ? <AppText variant="caption">{r.detail}</AppText> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
});
