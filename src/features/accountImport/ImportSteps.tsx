import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';

export const IMPORT_STEPS = ['Uploading', 'Reading', 'Extracting', 'Reviewing', 'Saved'] as const;
export type ImportStepName = (typeof IMPORT_STEPS)[number];

/**
 * Where the import is: Uploading → Reading → Extracting → Reviewing → Saved.
 * `failed` marks the current step as stopped (with the screen's retry options) —
 * the flow never sits on an endless spinner.
 */
export function ImportSteps({ current, failed }: { current: ImportStepName; failed?: boolean }) {
  const at = IMPORT_STEPS.indexOf(current);
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={`Import step ${at + 1} of ${IMPORT_STEPS.length}: ${current}${failed ? ' — stopped' : ''}`}>
      {IMPORT_STEPS.map((s, i) => {
        const done = i < at || (i === at && s === 'Saved');
        const active = i === at && !done;
        const color = failed && active ? colors.warning : done ? colors.positive : active ? colors.accentBright : colors.textTertiary;
        return (
          <View key={s} style={styles.step}>
            <View style={[styles.dot, { borderColor: color, backgroundColor: done ? color : 'transparent' }]}>
              {done ? <Icon name="checkmark" size={10} color={colors.bg} /> : failed && active ? <Icon name="alert-circle-outline" size={10} color={color} /> : null}
            </View>
            <AppText variant="caption" numberOfLines={1} style={[styles.label, { color }, active && styles.active]}>
              {s}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2, paddingVertical: spacing.xs },
  step: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4 },
  dot: { width: 16, height: 16, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10 },
  active: { fontWeight: '700' },
});
