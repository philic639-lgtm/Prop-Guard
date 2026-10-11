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
  /** A thin branded highlight along the top edge (key cards and actions). */
  accent?: Tone;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, tone, padded = true, raised, accent, accessibilityLabel }: CardProps) {
  const toneStyle = tone && tone !== 'neutral' ? { borderColor: toneColor[tone].fg + '55' } : null;
  const base = [styles.card, raised && styles.raised, padded && styles.padded, toneStyle, accent && styles.accented, style];
  const bar = accent ? <View pointerEvents="none" style={[styles.accentBar, { backgroundColor: toneColor[accent].fg }]} /> : null;
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && styles.pressed]}>
        {bar}
        {children}
      </Pressable>
    );
  }
  return (
    <View style={base} accessibilityLabel={accessibilityLabel}>
      {bar}
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
  accented: { overflow: 'hidden', backgroundColor: colors.cardRaised },
  accentBar: { position: 'absolute', top: 0, left: 18, right: 18, height: 2, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, opacity: 0.85 },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
