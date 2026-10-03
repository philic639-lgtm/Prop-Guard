import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'success' | 'caution';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: colors.accent, fg: colors.accentOn, border: colors.accent, pressed: colors.accentPressed },
  secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong, pressed: colors.card },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent', pressed: colors.accentMuted },
  danger: { bg: colors.danger, fg: '#fff', border: colors.danger, pressed: '#c93a3a' },
  success: { bg: colors.positive, fg: '#03140A', border: colors.positive, pressed: colors.positivePressed },
  caution: { bg: colors.warning, fg: '#1A1200', border: colors.warning, pressed: '#d99f06' },
  warning: { bg: colors.warningMuted, fg: colors.warning, border: colors.warning + '66', pressed: colors.warningMuted },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  size = 'lg',
  style,
  accessibilityHint,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'md' && styles.md,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border },
        pressed && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.inner}>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
          <AppText variant="bodyStrong" style={[styles.label, { color: v.fg }]}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

export const PrimaryButton = (p: Omit<ButtonProps, 'variant'>) => <Button {...p} variant="primary" />;
export const SecondaryButton = (p: Omit<ButtonProps, 'variant'>) => <Button {...p} variant="secondary" />;

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderWidth: 1,
  },
  md: { minHeight: 44 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { letterSpacing: 0.4 },
  pressed: { transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.45 },
});
