import type { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, webNoOutline, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

interface FieldRowProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Replace the input with a custom control (stepper, dropdown…). */
  control?: ReactNode;
  error?: string | null;
  prefix?: string;
}

/** Label on the left, compact input on the right — the mockup "Check Trade" form row. */
export function FieldRow({ label, control, error, prefix, onChangeText, ...rest }: FieldRowProps) {
  return (
    <View>
      <View style={styles.row}>
        <AppText variant="body" style={styles.label}>
          {label}
        </AppText>
        <View style={styles.right}>
          {control ?? (
            <View style={[styles.box, !!error && { borderColor: colors.danger }]}>
              {prefix ? (
                <AppText variant="body" tone="secondary">
                  {prefix}
                </AppText>
              ) : null}
              <TextInput
                accessibilityLabel={label}
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.accent}
                keyboardType="decimal-pad"
                inputMode="decimal"
                style={styles.input}
                onChangeText={(t) => onChangeText?.(rest.keyboardType && rest.keyboardType !== 'decimal-pad' ? t : t.replace(/[^0-9.\-]/g, ''))}
                maxFontSizeMultiplier={1.3}
                {...rest}
              />
            </View>
          )}
        </View>
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 50 },
  label: { flex: 1, color: colors.text },
  right: { flex: 1.25 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], ...webNoOutline },
  error: { textAlign: 'right' },
});
