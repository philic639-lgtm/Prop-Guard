import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, Illustration, RiskProgress, Screen, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { ExperienceSwitch } from '@/features/learning/ExperienceSwitch';
import { useQuickStart } from '@/features/learning/useQuickStart';

const TOOLS: { label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { label: 'Check a trade', sub: 'Risk + rules before entry', icon: 'shield-checkmark-outline', route: '/analyze' },
  { label: 'Setup Check', sub: 'Chart vs your strategy', icon: 'scan-outline', route: '/setup-check' },
  { label: 'Risk calculator', sub: 'Size from your stop', icon: 'calculator-outline', route: '/calculator' },
  { label: 'Import strategy', sub: 'In your own words', icon: 'create-outline', route: '/strategy/describe' },
  { label: 'Copy Trade', sub: 'Copy others, sized to you', icon: 'layers-outline', route: '/copy' },
  { label: 'Practice', sub: 'Replay scenarios', icon: 'flask-outline', route: '/practice' },
  { label: 'Performance', sub: 'From your journal', icon: 'stats-chart-outline', route: '/performance' },
];

/** Experienced quick start — straight to the tools, with setup status from real data. */
export default function QuickStartScreen() {
  const items = useQuickStart();
  const done = items.filter((i) => i.done).length;

  return (
    <Screen
      header={<AppHeader title="Quick start" subtitle="PLAN YOUR TRADE." back />}
      footer={<Button label="Go to dashboard" icon="grid-outline" onPress={() => router.replace('/home')} />}>
      <Card accent={done === items.length ? 'positive' : 'accent'} style={styles.hero}>
        <Illustration kind="shield" size={64} />
        <View style={[styles.flex, styles.gap]}>
          <AppText variant="label">Your setup</AppText>
          <AppText variant="title">
            {done} of {items.length} ready
          </AppText>
          <RiskProgress value={done / items.length} tone="positive" label="Setup progress" />
          <AppText variant="caption" tone="secondary">
            {done === items.length ? 'Everything Prop Guard needs is in place.' : `Next: ${items.find((i) => !i.done)?.title ?? ''}`}
          </AppText>
        </View>
      </Card>

      {items.map((i, n) => (
        <Card key={i.id} style={styles.item} onPress={() => router.push(i.route as never)} accessibilityLabel={`${i.title}: ${i.done ? 'done' : 'to do'}. ${i.detail}`}>
          <View style={[styles.step, i.done && styles.stepDone]}>
            {i.done ? (
              <Ionicons name="checkmark" size={16} color={colors.positive} />
            ) : (
              <AppText variant="bodyStrong" style={styles.stepNum}>
                {n + 1}
              </AppText>
            )}
          </View>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" style={i.done ? styles.doneText : null}>
              {i.title}
            </AppText>
            <AppText variant="caption">{i.detail}</AppText>
          </View>
          {i.done ? (
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          ) : (
            <View style={styles.cta}>
              <AppText variant="caption" tone="accent" style={styles.ctaText}>
                {i.cta}
              </AppText>
            </View>
          )}
        </Card>
      ))}

      <SectionHeader title="Tools" />
      <View style={styles.grid}>
        {TOOLS.map((t) => (
          <Card key={t.route} style={styles.tool} onPress={() => router.push(t.route as never)} accessibilityLabel={t.label}>
            <View style={styles.icon}>
              <Ionicons name={t.icon} size={18} color={colors.accentBright} />
            </View>
            <AppText variant="bodyStrong">{t.label}</AppText>
            <AppText variant="caption">{t.sub}</AppText>
          </Card>
        ))}
      </View>

      <ExperienceSwitch />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tool: { flexBasis: '47%', flexGrow: 1, gap: 4, padding: spacing.md },
  icon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center', marginBottom: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accentBright + '33' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  step: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  stepDone: { borderColor: colors.positive + '66', backgroundColor: colors.positiveMuted },
  stepNum: { fontSize: 13, color: colors.textSecondary },
  doneText: { color: colors.textSecondary },
  cta: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.accentMuted },
  ctaText: { fontWeight: '600', fontSize: 12 },
});
