import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

import { AppText } from './AppText';

/** Prop Guard wordmark: shield + "PropGuard". */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' | 'xl' }) {
  if (size === 'xl') {
    return (
      <View style={styles.xl} accessibilityRole="header" accessibilityLabel="Prop Guard">
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark" size={56} color={colors.positive} />
        </View>
        <AppText style={styles.xlText}>
          Prop<AppText style={[styles.xlText, { color: colors.accentBright }]}>Guard</AppText>
        </AppText>
      </View>
    );
  }
  const big = size === 'lg';
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Prop Guard">
      <Ionicons name="shield-checkmark" size={big ? 30 : 24} color={colors.positive} />
      <AppText style={[styles.text, big && { fontSize: 26 }]}>PropGuard</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { fontSize: 21, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  xl: { alignItems: 'center', gap: spacing.md },
  badge: {
    width: 104,
    height: 104,
    borderRadius: radius.xl + 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.positiveMuted,
    borderWidth: 1,
    borderColor: colors.positive + '55',
  },
  xlText: { fontSize: 38, fontWeight: '800', color: colors.text, letterSpacing: -1 },
});
