import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, Screen, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { GRADE_TONE } from '@/features/practice/components/PracticeScoreCard';
import { useAppStore } from '@/store/useAppStore';
import { shortDate } from '@/utils/format';

/** Journal → Practice lessons. Lessons saved from practice — never mixed with real-money trades. */
export default function PracticeLessonsScreen() {
  const lessons = useAppStore((s) => s.practiceLessons);
  const remove = useAppStore((s) => s.deletePracticeLesson);

  return (
    <Screen header={<AppHeader title="Practice lessons" subtitle="From practice — not real trades" back />}>
      {lessons.length === 0 ? (
        <Card>
          <EmptyState icon="school-outline" title="No lessons saved yet" message="After a practice scenario, tap Save Lesson to keep the key takeaway here." actionLabel="Go to Practice" onAction={() => router.push('/practice')} />
        </Card>
      ) : (
        lessons.map((l) => (
          <Card key={l.id}>
            <View style={styles.head}>
              <View style={styles.flex}>
                <AppText variant="heading">{l.strategyName}</AppText>
                <AppText variant="caption">
                  {l.instrument} · {shortDate(l.createdAt)}
                </AppText>
              </View>
              <StatusBadge label={`Score ${l.score} · ${l.grade}`} tone={GRADE_TONE[l.grade]} size="sm" />
            </View>
            <AppText variant="label" style={{ marginTop: spacing.md }}>
              Lesson
            </AppText>
            <AppText variant="body" style={{ marginTop: 4 }}>
              {l.lesson}
            </AppText>
            <View style={styles.actions}>
              <Button label="View strategy" size="md" variant="ghost" onPress={() => router.push({ pathname: '/strategy/library/[id]', params: { id: l.strategyId } })} />
              <Button label="Remove" size="md" variant="ghost" onPress={() => remove(l.id)} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});
