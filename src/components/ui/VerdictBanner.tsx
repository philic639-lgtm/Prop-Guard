import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing, toneColor, type Tone } from '@/constants/theme';

import { AppText } from './AppText';

interface VerdictBannerProps {
  tone: Extract<Tone, 'positive' | 'warning' | 'danger' | 'accent'>;
  title: string;
  subtitle?: string;
  /** e.g. "7/7" or "1:2 R:R" */
  badge?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

const ICON: Record<VerdictBannerProps['tone'], keyof typeof Ionicons.glyphMap> = {
  positive: 'shield-checkmark',
  warning: 'shield-half',
  danger: 'close-circle',
  accent: 'shield-checkmark',
};

/** Large status header: GOOD ENTRY / CAUTION / RULE VIOLATION / APPROVED. */
export function VerdictBanner({ tone, title, subtitle, badge, icon }: VerdictBannerProps) {
  const c = toneColor[tone];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${title}${badge ? `, ${badge}` : ''}${subtitle ? `. ${subtitle}` : ''}`}
      style={[styles.wrap, { backgroundColor: c.bg, borderColor: c.fg + '88' }]}>
      <View style={[styles.icon, { borderColor: c.fg + '66' }]}>
        <Ionicons name={icon ?? ICON[tone]} size={34} color={c.fg} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText style={[styles.title, { color: c.fg }]} numberOfLines={1} adjustsFontSizeToFit>
            {title}
          </AppText>
          {badge ? (
            <View style={[styles.badge, { borderColor: c.fg + '88' }]}>
              <AppText variant="caption" style={{ color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {badge}
              </AppText>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <AppText variant="caption" style={{ color: c.fg }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1.5 },
  icon: { width: 56, height: 56, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: 0.3, flexShrink: 1, textTransform: 'uppercase' },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 'auto' },
});
