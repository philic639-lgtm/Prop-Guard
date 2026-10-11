import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, radius, spacing } from '@/constants/theme';

/** One of the two ways into a strategy: a prominent icon, title, short description and an arrow. */
export function StrategyPathCard({ icon, title, description, accent, onPress }: { icon: IconName; title: string; description: string; accent: 'blue' | 'emerald'; onPress: () => void }) {
  const c = accent === 'blue' ? { fg: colors.accentBright, bg: colors.accentMuted, edge: colors.accentBright + '55' } : { fg: colors.positive, bg: colors.positiveMuted, edge: colors.positive + '55' };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.card, (hovered || pressed) && { borderColor: c.edge, backgroundColor: colors.cardRaised }, pressed && styles.pressed]}>
      <View style={[styles.iconTile, { backgroundColor: c.bg, borderColor: c.edge }]}>
        <Icon name={icon} size={28} color={c.fg} />
      </View>
      <View style={styles.text}>
        <AppText variant="label" style={[styles.title, { color: c.fg }]}>
          {title}
        </AppText>
        <AppText variant="body" tone="secondary" style={styles.desc}>
          {description}
        </AppText>
      </View>
      <View style={[styles.arrow, { borderColor: c.edge }]}>
        <Icon name="arrow-forward" size={16} color={c.fg} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  pressed: { transform: [{ scale: 0.99 }] },
  iconTile: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  text: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 13, letterSpacing: 1.2 },
  desc: { fontSize: 14, lineHeight: 20 },
  arrow: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
