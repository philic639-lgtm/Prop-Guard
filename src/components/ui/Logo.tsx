import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';
import { BrandMark } from './Illustration';

/** Prop Guard wordmark: shield + "PropGuard". */
export function Logo({ size = 'md', tagline = false }: { size?: 'md' | 'lg' | 'xl'; /** Show the slogan under the wordmark. */ tagline?: boolean }) {
  if (size === 'xl') {
    return (
      <View style={styles.xl} accessibilityRole="header" accessibilityLabel="Prop Guard">
        <View style={styles.badge}>
          <BrandMark size={60} />
        </View>
        <AppText style={styles.xlText}>
          Prop<AppText style={[styles.xlText, { color: colors.accentBright }]}>Guard</AppText>
        </AppText>
        <AppText style={styles.tagline}>PLAN YOUR TRADE.</AppText>
      </View>
    );
  }
  const big = size === 'lg';
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Prop Guard — Plan Your Trade.">
      <BrandMark size={big ? 34 : 28} />
      <View>
        <AppText style={[styles.text, big && { fontSize: 26 }]}>
          Prop<AppText style={[styles.text, big && { fontSize: 26 }, { color: colors.accentBright }]}>Guard</AppText>
        </AppText>
        {tagline ? <AppText style={styles.tagline}>PLAN YOUR TRADE.</AppText> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: 21, fontWeight: '800', color: colors.text, letterSpacing: -0.4, lineHeight: 24 },
  tagline: { fontSize: 9.5, fontWeight: '700', letterSpacing: 2.2, color: colors.textTertiary, marginTop: 1 },
  xl: { alignItems: 'center', gap: spacing.md },
  badge: {
    width: 104,
    height: 104,
    borderRadius: radius.xl + 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
    borderWidth: 1,
    borderColor: colors.accentBright + '44',
  },
  xlText: { fontSize: 38, fontWeight: '800', color: colors.text, letterSpacing: -1 },
});
