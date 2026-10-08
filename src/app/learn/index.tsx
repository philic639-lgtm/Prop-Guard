import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, RiskProgress, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { CURRICULUM } from '@/data/learning/curriculum';
import { ExperienceSwitch } from '@/features/learning/ExperienceSwitch';
import { continueLesson, lessonStatus, moduleProgress, overallProgress } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';

const STATUS_ICON = {
  completed: { name: 'checkmark-circle', color: colors.positive },
  skipped: { name: 'play-skip-forward-circle-outline', color: colors.textTertiary },
  started: { name: 'ellipse-outline', color: colors.accentBright },
  not_started: { name: 'ellipse-outline', color: colors.borderStrong },
} as const;

/** Beginner learning path — eight modules, progress saved automatically. */
export default function LearnHub() {
  const learning = useAppStore((s) => s.preferences.learning);
  const overall = useMemo(() => overallProgress(learning), [learning]);
  const next = useMemo(() => continueLesson(learning), [learning]);
  const plan = learning?.plan;

  const open = (id: string) => router.push({ pathname: '/learn/[lessonId]', params: { lessonId: id } });

  return (
    <Screen header={<AppHeader title="Learn" subtitle="PLAN YOUR TRADE." back />}>
      <Card raised style={styles.gapCard}>
        <View style={styles.headRow}>
          <View style={styles.flex}>
            <AppText variant="label">Your progress</AppText>
            <AppText variant="title">
              {overall.completed} / {overall.total} lessons
            </AppText>
          </View>
          <StatusBadge label={`${overall.pct}%`} tone={overall.pct === 100 ? 'positive' : 'accent'} />
        </View>
        <RiskProgress value={overall.pct / 100} tone="positive" label="Learning progress" />
        {overall.skipped ? (
          <AppText variant="caption" tone="tertiary">
            {overall.skipped} skipped — revisit them any time.
          </AppText>
        ) : null}
        {next ? (
          <Button label={overall.completed || overall.skipped ? `Continue: ${next.title}` : 'Start the first lesson'} icon="play" onPress={() => open(next.id)} />
        ) : (
          <AppText variant="bodyStrong" tone="positive">
            Path complete. Revisit any lesson below.
          </AppText>
        )}
      </Card>

      <View style={styles.tools}>
        <Card style={styles.tool} onPress={() => router.push('/learn/personality')} accessibilityLabel="Trading personality">
          <Ionicons name="person-outline" size={20} color={colors.accentBright} />
          <AppText variant="bodyStrong">Personality</AppText>
          <AppText variant="caption">{learning?.personality ? learning.personality.archetype : 'Not taken yet'}</AppText>
        </Card>
        <Card style={styles.tool} onPress={() => router.push('/learn/strategies')} accessibilityLabel="Strategy matches">
          <Ionicons name="compass-outline" size={20} color={colors.accentBright} />
          <AppText variant="bodyStrong">Matches</AppText>
          <AppText variant="caption">From the library</AppText>
        </Card>
        <Card style={styles.tool} onPress={() => router.push('/learn/plan')} accessibilityLabel="Trading plan">
          <Ionicons name="map-outline" size={20} color={colors.accentBright} />
          <AppText variant="bodyStrong">My plan</AppText>
          <AppText variant="caption">{plan ? 'Applied' : 'Not built yet'}</AppText>
        </Card>
      </View>

      {CURRICULUM.map((m) => {
        const p = moduleProgress(learning, m);
        return (
          <View key={m.id} style={styles.module}>
            <SectionHeader title={`${m.n}. ${m.title}`} />
            <Card padded={false}>
              <View style={styles.modHead}>
                <View style={styles.modIcon}>
                  <Ionicons name={m.icon} size={18} color={colors.accentBright} />
                </View>
                <AppText variant="caption" style={styles.flex}>
                  {m.description}
                </AppText>
                <AppText variant="caption" tone={p.completed === p.total ? 'positive' : 'tertiary'}>
                  {p.completed}/{p.total}
                </AppText>
              </View>
              {m.lessons.map((l) => {
                const st = lessonStatus(learning, l.id);
                const icon = STATUS_ICON[st];
                return (
                  <Card key={l.id} padded={false} style={styles.lesson} onPress={() => open(l.id)} accessibilityLabel={`${l.title}, ${st.replace('_', ' ')}`}>
                    <Ionicons name={icon.name} size={20} color={icon.color} />
                    <View style={styles.flex}>
                      <AppText variant="bodyStrong">{l.title}</AppText>
                      <AppText variant="caption" numberOfLines={1}>
                        {l.minutes} min · {l.summary}
                      </AppText>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </Card>
                );
              })}
            </Card>
          </View>
        );
      })}

      <ExperienceSwitch />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gapCard: { gap: spacing.md },
  tools: { flexDirection: 'row', gap: spacing.sm },
  tool: { flex: 1, gap: 4, padding: spacing.md },
  module: { gap: spacing.sm },
  modHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  modIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  lesson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 0,
    borderRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: 'transparent',
  },
});
