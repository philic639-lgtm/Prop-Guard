import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, RiskProgress, Screen, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { ExperienceSwitch } from '@/features/learning/ExperienceSwitch';
import { useQuickStart } from '@/features/learning/useQuickStart';

const TOOLS: { label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; route: string }[] = [
  { label: 'Check a trade', sub: 'Risk + rules before entry', icon: 'shield-checkmark-outline', route: '/analyze' },
  { label: 'Setup Check', sub: 'Chart vs your strategy', icon: 'scan-outline', route: '/setup-check' },
  { label: 'Risk calculator', sub: 'Size from your stop', icon: 'calculator-outline', route: '/calculator' },
  { label: 'Import strategy', sub: 'In your own words', icon: 'create-outline', route: '/strategy/describe' },
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
      <Card raised style={styles.gap}>
        <AppText variant="label">Setup</AppText>
        <AppText variant="title">
          {done} / {items.length} ready
        </AppText>
        <RiskProgress value={done / items.length} tone="positive" label="Setup progress" />
      </Card>

      {items.map((i) => (
        <Card key={i.id} style={styles.item} onPress={() => router.push(i.route as never)} accessibilityLabel={`${i.title}: ${i.done ? 'done' : 'to do'}. ${i.detail}`}>
          <Ionicons name={i.done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={i.done ? colors.positive : colors.borderStrong} />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{i.title}</AppText>
            <AppText variant="caption">{i.detail}</AppText>
          </View>
          <AppText variant="caption" tone={i.done ? 'tertiary' : 'accent'}>
            {i.cta}
          </AppText>
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
  icon: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
});
