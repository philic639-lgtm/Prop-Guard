import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, CircularScore } from '@/components/ui';
import { colors, spacing, type Tone } from '@/constants/theme';
import { SCORE_WEIGHTS } from '@/lib/engines';
import type { PracticeScore } from '@/types/practice';

export const GRADE_TONE: Record<PracticeScore['grade'], Tone> = { 'A+': 'positive', A: 'positive', B: 'accent', C: 'warning', D: 'danger' };

const COMPONENT_LABEL: Record<keyof PracticeScore['components'], string> = {
  strategyMatch: 'Strategy match',
  trendAlignment: 'Trend alignment',
  entryQuality: 'Entry quality',
  riskReward: 'Risk : reward',
  timing: 'Timing',
};

/** PROP GUARD SCORE — deterministic rule-based score with strengths, mistakes and the lesson. */
export function PracticeScoreCard({ score }: { score: PracticeScore }) {
  const tone = GRADE_TONE[score.grade];
  return (
    <Card>
      <AppText variant="label" tone="accent" align="center">
        Prop Guard score
      </AppText>
      <View style={styles.center}>
        <CircularScore value={score.total} suffix="" tone={tone} size={124} label={`/ 100 · ${score.grade}`} />
        <AppText variant="heading" style={{ color: colors.text, marginTop: spacing.sm }}>
          {score.verdict.toUpperCase()}
        </AppText>
      </View>

      <View style={styles.components}>
        {(score.breakdown ?? (Object.keys(COMPONENT_LABEL) as (keyof PracticeScore['components'])[]).map((k) => ({ key: k, label: COMPONENT_LABEL[k], value: score.components[k], max: SCORE_WEIGHTS[k] }))).map(({ key, label, value: v, max }) => (
          <View key={key} style={styles.compRow}>
            <AppText variant="caption" style={styles.compLabel}>
              {label}
            </AppText>
            <View style={styles.bar}>
              <View style={[styles.fill, { width: `${(v / max) * 100}%`, backgroundColor: v / max >= 0.7 ? colors.positive : v / max >= 0.4 ? colors.warning : colors.danger }]} />
            </View>
            <AppText variant="caption" style={styles.compVal}>
              {v}/{max}
            </AppText>
          </View>
        ))}
      </View>

      {score.strengths.map((s) => (
        <View key={s} style={styles.line}>
          <Ionicons name="checkmark" size={16} color={colors.positive} />
          <AppText variant="body" style={styles.flex}>
            {s}
          </AppText>
        </View>
      ))}
      {score.mistakes.length ? (
        <AppText variant="label" tone="warning" style={{ marginTop: spacing.md }}>
          {score.mistakes.length === 1 ? 'Mistake' : 'Mistakes'}
        </AppText>
      ) : null}
      {score.mistakes.map((s) => (
        <View key={s} style={styles.line}>
          <Ionicons name="close" size={16} color={colors.danger} />
          <AppText variant="body" style={styles.flex}>
            {s}
          </AppText>
        </View>
      ))}
      <View style={styles.lesson}>
        <AppText variant="label" tone="accent">
          Lesson
        </AppText>
        <AppText variant="body" style={{ marginTop: 4 }}>
          {score.lesson}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', marginTop: spacing.md },
  flex: { flex: 1 },
  components: { marginTop: spacing.lg, marginBottom: spacing.sm, gap: spacing.sm },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  compLabel: { width: 108 },
  compVal: { width: 40, textAlign: 'right' },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  line: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  lesson: { marginTop: spacing.lg, padding: spacing.md, borderRadius: 12, backgroundColor: colors.accentMuted },
});
