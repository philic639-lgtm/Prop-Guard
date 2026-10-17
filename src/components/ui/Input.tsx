import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, webNoOutline, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  inputStyle?: TextInputProps['style'];
  label?: string;
  hint?: string;
  error?: string | null;
  prefix?: string;
  suffix?: string;
  large?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, hint, error, prefix, suffix, large, inputStyle, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={[styles.field, focused && styles.focused, !!error && styles.errored]}>
        {prefix ? (
          <AppText variant={large ? 'number' : 'body'} tone="secondary">
            {prefix}
          </AppText>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          accessibilityLabel={label}
          style={[styles.input, large && styles.large, rest.multiline && styles.multiline, inputStyle]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          maxFontSizeMultiplier={1.3}
          {...rest}
        />
        {suffix ? (
          <AppText variant="caption" tone="secondary">
            {suffix}
          </AppText>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="tertiary">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

/** Numeric field — decimal keyboard, tabular figures. Value stays a string for editing. */
export function NumericInput({ value, onChangeText, ...rest }: InputProps) {
  return (
    <Input
      keyboardType="decimal-pad"
      inputMode="decimal"
      returnKeyType="done"
      value={value}
      onChangeText={(t) => onChangeText?.(t.replace(/[^0-9.\-]/g, ''))}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
  },
  focused: { borderColor: colors.accent },
  errored: { borderColor: colors.danger },
  input: {
    flex: 1,
    // Let the field shrink to its column (web inputs otherwise keep an intrinsic width).
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    paddingVertical: spacing.md,
    fontVariant: ['tabular-nums'],
    ...webNoOutline,
  },
  large: { fontSize: 22, fontWeight: '600' },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
