import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, RiskProgress } from '@/components/ui';
import { Icon } from '@/components/ui/Icon';
import { colors, spacing } from '@/constants/theme';
import { continueLesson, experienceMode, overallProgress } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';

import { useQuickStart } from './useQuickStart';

/** Home entry point: "Continue learning" for beginners, "Quick start" for experienced traders until set up. */
export function HomeModeCard() {
  const prefs = useAppStore((s) => s.preferences);
  const mode = experienceMode(prefs);
  const learning = prefs.learning;
  const overall = useMemo(() => overallProgress(learning), [learning]);
  const next = useMemo(() => continueLesson(learning), [learning]);
  const quick = useQuickStart();

  if (mode === 'beginner') {
    return (
      <Card tone="accent" style={styles.card} onPress={() => (next ? router.push({ pathname: '/learn/[lessonId]', params: { lessonId: next.id } }) : router.push('/learn'))} accessibilityLabel="Continue learning">
        <View style={styles.row}>
          <Icon name="school-outline" size={20} color={colors.accentBright} />
          <AppText variant="label" style={styles.flex}>
            Learning path · {overall.completed}/{overall.total}
          </AppText>
          <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
        </View>
        <AppText variant="heading">{next ? (overall.completed || overall.skipped ? `Continue: ${next.title}` : `Start: ${next.title}`) : 'Path complete — revisit any lesson'}</AppText>
        <RiskProgress value={overall.pct / 100} tone="positive" height={6} label="Learning progress" />
      </Card>
    );
  }

  const todo = quick.filter((i) => !i.done);
  if (!todo.length) return null;
  const done = quick.length - todo.length;
  // A slim strip: present until setup is done, never the biggest thing on the dashboard.
  return (
    <Card style={styles.strip} onPress={() => router.push('/start')} accessibilityLabel={`Quick start, ${done} of ${quick.length} done. Next: ${todo[0].title}`}>
      <Icon name="flash-outline" size={18} color={colors.accentBright} />
      <View style={styles.flex}>
        <AppText variant="caption" tone="secondary" numberOfLines={1}>
          Quick start {done}/{quick.length} · <AppText variant="caption" tone="primary">Next: {todo[0].title}</AppText>
        </AppText>
        <RiskProgress value={done / quick.length} tone="positive" height={4} label="Quick start progress" />
      </View>
      <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, gap: 6 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});
