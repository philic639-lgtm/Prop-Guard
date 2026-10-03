import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Tinted border + glow for status cards. */
  tone?: Tone;
  padded?: boolean;
  raised?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, tone, padded = true, raised, accessibilityLabel }: CardProps) {
  const toneStyle = tone && tone !== 'neutral' ? { borderColor: toneColor[tone].fg + '55' } : null;
  const base = [styles.card, raised && styles.raised, padded && styles.padded, toneStyle, style];
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View style={base} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  raised: { backgroundColor: colors.cardRaised },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
