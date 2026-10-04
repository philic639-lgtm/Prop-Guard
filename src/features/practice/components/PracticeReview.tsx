import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DetailTable, RuleChecklist, SectionHeader, StatusBadge } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { formatPrice } from '@/lib/engines';
import type { PracticeAttempt, PracticeScenario, PracticeScore, ReplayOutcome } from '@/types/practice';

const DECISION = { long: 'LONG', short: 'SHORT', wait: 'WAIT' } as const;
const RESULT_LABEL: Record<PracticeAttempt['result'], string> = {
  win: 'WIN',
  loss: 'LOSS',
  expired: 'EXPIRED',
  'not-filled': 'NOT FILLED',
  'correct-wait': 'CORRECT WAIT',
  'incorrect-wait': 'MISSED SETUP',
};

interface PracticeReviewProps {
  scenario: PracticeScenario;
  attempt: PracticeAttempt;
  score: PracticeScore;
  replay: ReplayOutcome;
  lessonSaved: boolean;
  onSaveLesson: () => void;
  onPracticeAgain: () => void;
  onNext: () => void;
}

/** After-action review: decision vs ideal, what went well, what was missed, and the strategy rules. */
export function PracticeReview({ scenario: s, attempt: a, score, replay, lessonSaved, onSaveLesson, onPracticeAgain, onNext }: PracticeReviewProps) {
  const t = getTemplate(s.strategyId);
  const p = (v: number | undefined) => (v == null ? '—' : formatPrice(s.instrument, v));
  const resultTone = a.result === 'win' || a.result === 'correct-wait' ? 'positive' : a.result === 'loss' || a.result === 'incorrect-wait' ? 'danger' : 'warning';

  return (
    <View style={{ gap: spacing.md }}>
      <SectionHeader title="After-action review" />
      <Card>
        <View style={styles.head}>
          <StatusBadge label={a.correct ? 'Correct read' : 'Incorrect read'} tone={a.correct ? 'positive' : 'danger'} icon={a.correct ? 'checkmark' : 'close'} size="sm" />
          <StatusBadge label={RESULT_LABEL[a.result]} tone={resultTone} size="sm" />
        </View>
        <DetailTable
          rows={[
            { label: 'Your decision', value: DECISION[a.decision], tone: a.decision === 'long' ? 'positive' : a.decision === 'short' ? 'danger' : 'primary' },
            { label: 'Ideal decision', value: DECISION[s.idealDecision], bold: true },
            { label: 'Your entry', value: p(a.entry) },
            { label: 'Ideal entry', value: p(s.idealTrade?.entry) },
            { label: 'Your stop / target', value: a.decision === 'wait' ? '—' : `${p(a.stop)} / ${p(a.target)}` },
            { label: 'Ideal stop / target', value: s.idealTrade ? `${p(s.idealTrade.stop)} / ${p(s.idealTrade.target)}` : '—' },
            { label: 'Your R:R', value: a.riskReward != null ? `1:${a.riskReward}` : '—' },
            { label: 'Result', value: RESULT_LABEL[a.result], tone: resultTone === 'warning' ? 'warning' : resultTone, bold: true },
            { label: 'Prop Guard score', value: `${a.score} / 100 · ${a.grade}` },
          ]}
        />
        <AppText variant="caption" style={{ marginTop: spacing.sm }}>
          {s.outcome.summary}
          {replay.status === 'expired' ? ' Your trade was still open when the session ended.' : ''}
        </AppText>
      </Card>

      <Card tone="positive">
        <AppText variant="label" tone="positive">
          What you did well
        </AppText>
        {(score.strengths.length ? score.strengths : ['You made a decision before seeing the outcome — that is the habit this trainer builds.']).map((x) => (
          <Line key={x} icon="checkmark" color={colors.positive} text={x} />
        ))}
      </Card>

      <Card tone={score.mistakes.length ? 'warning' : undefined}>
        <AppText variant="label" tone="warning">
          What you missed
        </AppText>
        {(score.mistakes.length ? score.mistakes : ['Nothing significant — your decision matched the rules.']).map((x) => (
          <Line key={x} icon="alert-circle-outline" color={colors.warning} text={x} />
        ))}
        <AppText variant="caption" style={{ marginTop: spacing.md }}>
          Common mistake on this setup: {s.commonMistake}
        </AppText>
      </Card>

      <Card>
        <AppText variant="label" tone="accent">
          Key lesson
        </AppText>
        <AppText variant="body" style={{ marginTop: spacing.sm }}>
          {s.lesson}
        </AppText>
        <AppText variant="label" style={{ marginTop: spacing.lg }}>
          Why this was {s.idealDecision === 'wait' ? 'a WAIT' : `a ${DECISION[s.idealDecision]}`}
        </AppText>
        {s.explanation.map((x) => (
          <Line key={x} icon="ellipse" color={colors.accentBright} text={x} small />
        ))}
      </Card>

      {t ? (
        <>
          <SectionHeader title={`Strategy rules used · ${t.shortName}`} />
          <Card>
            <RuleChecklist rows={t.checklist.map((c) => ({ id: c, label: c, state: s.idealDecision === 'wait' ? ('pending' as const) : ('pass' as const) }))} />
            <AppText variant="caption" style={{ marginTop: spacing.sm }}>
              {s.idealDecision === 'wait' ? 'At the decision point these rules were not all satisfied.' : 'All of these rules were satisfied at the decision point.'}
            </AppText>
          </Card>
        </>
      ) : null}

      <View style={styles.btnRow}>
        <Button label="View Strategy" icon="book-outline" variant="secondary" size="md" style={styles.flex} onPress={() => router.push({ pathname: '/strategy/library/[id]', params: { id: s.strategyId } })} />
        <Button label={lessonSaved ? 'Lesson saved' : 'Save Lesson'} icon={lessonSaved ? 'checkmark' : 'bookmark-outline'} variant="secondary" size="md" style={styles.flex} disabled={lessonSaved} onPress={onSaveLesson} />
      </View>
      <View style={styles.btnRow}>
        <Button label="Practice Again" icon="refresh" variant="secondary" style={styles.flex} onPress={onPracticeAgain} />
        <Button label="Next Scenario" icon="arrow-forward" style={styles.flex} onPress={onNext} />
      </View>
    </View>
  );
}

function Line({ icon, color, text, small }: { icon: keyof typeof Ionicons.glyphMap; color: string; text: string; small?: boolean }) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={small ? 7 : 16} color={color} style={small ? { marginTop: 7 } : undefined} />
      <AppText variant="body" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  line: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
});
