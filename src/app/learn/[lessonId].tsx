import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ScrollView } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, RiskProgress, Screen, StatusBadge } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { findLesson, moduleOfLesson, type LessonBlock, type QuizQuestion } from '@/data/learning/curriculum';
import { getTemplate } from '@/data/strategyLibrary';
import { LessonWidget } from '@/features/learning/widgets';
import { StrategyVisualExample } from '@/features/strategy/StrategyVisualExample';
import { gradeQuiz, lessonAfter, lessonStatus, markLesson } from '@/lib/engines/learningEngine';
import { useAppStore } from '@/store/useAppStore';

export default function LessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  // Keyed so moving to the next lesson starts with fresh quiz answers and scroll.
  return <LessonView key={lessonId} lessonId={lessonId} />;
}

function LessonView({ lessonId }: { lessonId: string }) {
  const lesson = findLesson(lessonId);
  const module = lesson ? moduleOfLesson(lesson.id) : undefined;
  const learning = useAppStore((s) => s.preferences.learning);
  const updateLearning = useAppStore((s) => s.updateLearning);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const scrollRef = useRef<ScrollView>(null);

  // Auto-save: opening a lesson marks it started (never downgrades a completed one).
  useEffect(() => {
    if (!lesson) return;
    updateLearning((p) => markLesson(p, lesson.id, 'started', new Date()));
  }, [lesson, updateLearning]);

  const questions = (lesson?.blocks ?? []).flatMap((b) => (b.kind === 'quiz' ? b.questions : []));
  const grade = gradeQuiz(questions, answers);
  const quizDone = grade.answered === grade.total;

  if (!lesson || !module) {
    return (
      <Screen header={<AppHeader title="Lesson" back />}>
        <EmptyState icon="book-outline" title="Lesson not found" message="It may have moved." actionLabel="All lessons" onAction={() => router.replace('/learn')} />
      </Screen>
    );
  }

  const status = lessonStatus(learning, lesson.id);
  const index = module.lessons.findIndex((l) => l.id === lesson.id);
  const next = lessonAfter(lesson.id);

  const goNext = () => (next ? router.replace({ pathname: '/learn/[lessonId]', params: { lessonId: next.id } }) : router.replace('/learn'));
  const complete = () => {
    updateLearning((p) => markLesson(p, lesson.id, 'completed', new Date(), questions.length ? grade.score : null));
    goNext();
  };
  const skip = () => {
    updateLearning((p) => markLesson(p, lesson.id, 'skipped', new Date()));
    goNext();
  };

  const footer = (
    <View style={styles.footer}>
      <Button
        label={questions.length && !quizDone ? `Answer the quiz (${grade.answered}/${grade.total})` : next ? 'Complete & next lesson' : 'Complete the path'}
        icon="checkmark"
        disabled={questions.length > 0 && !quizDone}
        onPress={complete}
      />
      {status !== 'completed' ? <Button label="Skip for now" variant="ghost" onPress={skip} /> : null}
    </View>
  );

  return (
    <Screen scrollRef={scrollRef} header={<AppHeader title={`${module.n}. ${module.title}`} subtitle={`Lesson ${index + 1} of ${module.lessons.length} · ${lesson.minutes} min`} back onBack={() => router.replace('/learn')} />} footer={footer}>
      <RiskProgress value={(index + 1) / module.lessons.length} tone="accent" height={4} label="Module progress" />
      <View style={styles.titleRow}>
        <AppText variant="title" style={styles.flex}>
          {lesson.title}
        </AppText>
        {status === 'completed' ? <StatusBadge label="Completed" tone="positive" size="sm" /> : status === 'skipped' ? <StatusBadge label="Skipped" size="sm" /> : null}
      </View>
      <AppText variant="body" tone="secondary">
        {lesson.summary}
      </AppText>

      {lesson.blocks.map((b, i) => (
        <Block key={i} block={b} answers={answers} onAnswer={(id, v) => setAnswers((a) => (a[id] != null ? a : { ...a, [id]: v }))} />
      ))}

      {questions.length && quizDone ? (
        <Card tone={grade.passed ? 'positive' : 'warning'} style={styles.gapCard}>
          <AppText variant="heading">
            Quiz: {grade.correct}/{grade.total} correct
          </AppText>
          <AppText variant="caption" tone="secondary">
            {grade.passed ? 'Nice — you’ve got the key idea.' : 'Read the explanations above, then continue — you can revisit this lesson any time.'}
          </AppText>
        </Card>
      ) : null}
    </Screen>
  );
}

function Block({ block: b, answers, onAnswer }: { block: LessonBlock; answers: Record<string, number>; onAnswer: (id: string, v: number) => void }) {
  switch (b.kind) {
    case 'text':
      return (
        <View style={styles.text}>
          {b.title ? <AppText variant="heading">{b.title}</AppText> : null}
          <AppText variant="body">{b.body}</AppText>
        </View>
      );
    case 'keyPoints':
      return (
        <Card style={styles.gapCard}>
          <AppText variant="label">Key points</AppText>
          {b.points.map((p) => (
            <View key={p} style={styles.point}>
              <Ionicons name="checkmark-circle" size={16} color={colors.positive} style={styles.pointIcon} />
              <AppText variant="body" style={styles.flex}>
                {p}
              </AppText>
            </View>
          ))}
        </Card>
      );
    case 'visual': {
      const t = getTemplate(b.templateId);
      if (!t?.visual) return null;
      return (
        <View style={styles.text}>
          <AppText variant="caption" tone="secondary">
            {b.caption}
          </AppText>
          <StrategyVisualExample visual={t.visual} strategyName={t.shortName} />
        </View>
      );
    }
    case 'interactive':
      return (
        <Card raised style={styles.gapCard}>
          <View style={styles.point}>
            <Ionicons name="hand-left-outline" size={16} color={colors.accentBright} style={styles.pointIcon} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              Try it · {b.caption}
            </AppText>
          </View>
          <LessonWidget kind={b.widget} />
        </Card>
      );
    case 'quiz':
      return (
        <View style={styles.text}>
          <AppText variant="label">Quick check</AppText>
          {b.questions.map((q) => (
            <Question key={q.id} q={q} picked={answers[q.id]} onPick={(v) => onAnswer(q.id, v)} />
          ))}
        </View>
      );
    case 'practice':
      return (
        <Card tone="accent" style={styles.gapCard}>
          <AppText variant="heading">{b.title}</AppText>
          <AppText variant="caption" tone="secondary">
            {b.body}
          </AppText>
          <Button label={b.action.label} variant="secondary" icon="arrow-forward" onPress={() => router.push(b.action.params ? { pathname: b.action.route as never, params: b.action.params } : (b.action.route as never))} />
        </Card>
      );
  }
}

function Question({ q, picked, onPick }: { q: QuizQuestion; picked: number | undefined; onPick: (v: number) => void }) {
  const answered = picked != null;
  return (
    <Card style={styles.gapCard}>
      <AppText variant="bodyStrong">{q.prompt}</AppText>
      {q.choices.map((c, i) => {
        const isAnswer = i === q.answer;
        const chosen = picked === i;
        const tone = answered && isAnswer ? colors.positive : answered && chosen ? colors.danger : colors.border;
        return (
          <Pressable
            key={c}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen, disabled: answered }}
            accessibilityLabel={c}
            disabled={answered}
            onPress={() => onPick(i)}
            style={[styles.choice, { borderColor: tone }, chosen && { backgroundColor: colors.surface }]}>
            <AppText variant="body" style={styles.flex}>
              {c}
            </AppText>
            {answered && isAnswer ? <Ionicons name="checkmark-circle" size={18} color={colors.positive} /> : null}
            {answered && chosen && !isAnswer ? <Ionicons name="close-circle" size={18} color={colors.danger} /> : null}
          </Pressable>
        );
      })}
      {answered ? (
        <AppText variant="caption" tone={picked === q.answer ? 'positive' : 'warning'}>
          {picked === q.answer ? 'Correct. ' : 'Not quite. '}
          {q.explanation}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { gap: spacing.sm },
  gapCard: { gap: spacing.sm },
  point: { flexDirection: 'row', gap: spacing.sm },
  pointIcon: { marginTop: 2 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
});
