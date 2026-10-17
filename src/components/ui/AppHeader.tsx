import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { goBack } from '@/utils/navigation';
import { colors, GUTTER, spacing } from '@/constants/theme';

import { Icon, type IconName } from './Icon';
import { AppText } from './AppText';
import { BrandMark } from './Illustration';

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  /** Brand header used on top-level tabs. */
  brand?: boolean;
}

export function AppHeader({ title, subtitle, back, onBack, right, brand }: AppHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={12}
            onPress={onBack ?? (() => goBack())}
            style={styles.back}>
            <Icon name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={styles.titles}>
          {brand ? (
            <View style={styles.brand}>
              <BrandMark size={20} />
              <AppText variant="label" tone="primary" style={styles.brandText}>
                {title ?? 'PROP GUARD'}
              </AppText>
            </View>
          ) : title ? (
            <AppText variant="label" tone="primary" style={styles.title} numberOfLines={1}>
              {title}
            </AppText>
          ) : null}
          {subtitle ? (
            <AppText variant="caption" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export function HeaderIconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress} style={styles.iconBtn}>
      <Icon name={icon} size={20} color={colors.text} />
      {badge ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  titles: { flex: 1 },
  title: { fontSize: 13 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandText: { fontSize: 13, letterSpacing: 2.4 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
