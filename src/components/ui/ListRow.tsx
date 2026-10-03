import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

interface ListRowProps {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconTone?: Tone;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  chevron?: boolean;
}

export function ListRow({ title, subtitle, value, icon, iconTone = 'neutral', onPress, right, destructive, chevron = !!onPress }: ListRowProps) {
  const tone = toneColor[destructive ? 'danger' : iconTone];
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${title}, ${value}` : title}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      {icon ? (
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Ionicons name={icon} size={17} color={tone.fg} />
        </View>
      ) : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong" style={destructive ? { color: colors.danger } : undefined}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="body" tone="secondary" style={styles.value}>
          {value}
        </AppText>
      ) : null}
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  value: { fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
