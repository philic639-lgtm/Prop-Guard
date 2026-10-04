import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Button, Card, EmptyState, RuleChecklist, Screen, StatusBadge, VerdictBanner } from '@/components/ui';
import { PRACTICE_DISCLAIMER, SAMPLE_DATA_NOTE } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { getTemplate } from '@/data/strategyLibrary';
import { PracticeChart } from '@/features/practice/components/PracticeChart';
import { PracticeDecision } from '@/features/practice/components/PracticeDecision';
import { PracticeReplayControls, type ReplaySpeed } from '@/features/practice/components/PracticeReplayControls';
import { PracticeReview } from '@/features/practice/components/PracticeReview';
import { PracticeScoreCard } from '@/features/practice/components/PracticeScoreCard';
import { pickScenario, usePracticeSetup, type PracticeMode } from '@/features/practice/selection';
import { attemptResult, practiceTradeMetrics, scorePracticeDecision, simulatePracticeTrade } from '@/lib/engines';
import { scenarioProvider } from '@/services/marketHistory';
import { useAppStore } from '@/store/useAppStore';
import type { PracticeAttempt, PracticeScenario, PracticeScore, PracticeTradeInput, ReplayOutcome } from '@/types/practice';
import { uuid } from '@/utils/id';

const BIAS_LABEL = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' } as const;
const STEP_MS = 900;

/** Historical Trading Trainer session: decide before the reveal, get scored, replay the market, review. */
export default function PracticeSessionScreen() {
  const { id, mode, reason } = useLocalSearchParams<{ id: string; mode?: PracticeMode; reason?: string }>();
  const scenario = id ? scenarioProvider.get(id) : undefined;
  if (!scenario) {
    return (
      <Screen header={<AppHeader title="Practice" back />}>
        <EmptyState icon="school-outline" title="Scenario not found" message="Pick a new scenario from Practice." actionLabel="Back to Practice" onAction={() => router.replace('/practice')} />
      </Screen>
    );
  }
  // Remount per scenario so every run starts clean.
  return <Session key={scenario.id} scenario={scenario} mode={mode ?? 'standard'} reason={reason} />;
}

type Phase = 'decide' | 'scored' | 'replay';

function Session({ scenario: s, mode, reason }: { scenario: PracticeScenario; mode: PracticeMode; reason?: string }) {
  const addAttempt = useAppStore((st) => st.addPracticeAttempt);
  const saveLesson = useAppStore((st) => st.savePracticeLesson);
  const lessons = useAppStore((st) => st.practiceLessons);
  const template = getTemplate(s.strategyId);

  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>('decide');
  const [input, setInput] = useState<PracticeTradeInput | null>(null);
  const [score, setScore] = useState<PracticeScore | null>(null);
  const [replay, setReplay] = useState<ReplayOutcome | null>(null);
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);

  const afterTotal = s.candles.length - s.decisionIndex - 1;
  const finished = phase === 'replay' && position >= afterTotal;
  const isPlaying = playing && position < afterTotal;
  const visibleCount = s.decisionIndex + 1 + (phase === 'replay' ? position : 0);

  useEffect(() => {
    if (!isPlaying) return;
    const t = setTimeout(() => setPosition((p) => Math.min(afterTotal, p + 1)), STEP_MS / speed);
    return () => clearTimeout(t);
  }, [isPlaying, position, speed, afterTotal]);

  const submit = (i: PracticeTradeInput) => {
    const sc = scorePracticeDecision(s, i);
    const rp = simulatePracticeTrade(s.candles, s.decisionIndex, i);
    const m = i.decision !== 'wait' && i.entry != null && i.stop != null && i.target != null ? practiceTradeMetrics(s.instrument, i.entry, i.stop, i.target) : null;
    const a: PracticeAttempt = {
      id: uuid(),
      scenarioId: s.id,
      instrument: s.instrument,
      strategyId: s.strategyId,
      strategyName: s.strategyName,
      timestamp: new Date().toISOString(),
      mode,
      session: s.session,
      direction: s.direction,
      decision: i.decision,
      idealDecision: s.idealDecision,
      correct: sc.correct,
      entry: i.entry,
      stop: i.stop,
      target: i.target,
      riskReward: m?.rr,
      score: sc.total,
      grade: sc.grade,
      result: attemptResult(i.decision, s.idealDecision, rp),
      mistakes: sc.mistakes,
      setupCharacteristics: {
        retestNumber: s.setupCharacteristics.retestNumber,
        trendAligned: s.setupCharacteristics.trendAligned,
        entryQuality: s.setupCharacteristics.entryQuality,
      },
    };
    addAttempt(a); // persisted immediately — the outcome is already determined by the data
    setInput(i);
    setScore(sc);
    setReplay(rp);
    setAttempt(a);
    setPhase('scored');
  };

  const startReplay = () => {
    setPhase('replay');
    setPosition(0);
    setPlaying(true);
  };

  const practiceAgain = () => {
    setRun((r) => r + 1);
    setPhase('decide');
    setInput(null);
    setScore(null);
    setReplay(null);
    setAttempt(null);
    setPosition(0);
    setPlaying(false);
  };

  const next = () => {
    const st = useAppStore.getState();
    const { setup } = usePracticeSetup.getState();
    const pick = pickScenario(mode, setup, st.practiceAttempts, s.id);
    if (!pick) return router.replace('/practice');
    router.replace({ pathname: '/practice/session', params: { id: pick.scenario.id, mode, reason: pick.reason ?? '' } });
  };

  const user = input && input.decision !== 'wait' && input.entry != null && input.stop != null && input.target != null ? { entry: input.entry, stop: input.stop, target: input.target } : null;
  const exitShown = replay?.exitIndex != null && visibleCount - 1 >= replay.exitIndex;
  const banner = useMemo(() => {
    if (phase !== 'replay' || !replay) return null;
    if (replay.status === 'target' && exitShown) return { tone: 'positive' as const, title: 'TARGET HIT', subtitle: 'Price reached your target before your stop.' };
    if (replay.status === 'stop' && exitShown) return { tone: 'danger' as const, title: 'STOP HIT', subtitle: 'Price reached your stop first — the defined risk did its job.' };
    if (!finished) return null;
    if (replay.status === 'expired') return { tone: 'warning' as const, title: 'TRADE EXPIRED', subtitle: 'Session ended — neither your stop nor your target was reached.' };
    if (replay.status === 'not_filled') return { tone: 'warning' as const, title: 'ENTRY NOT FILLED', subtitle: 'Price never traded at your entry before the session ended.' };
    return { tone: s.idealDecision === 'wait' ? ('positive' as const) : ('warning' as const), title: 'MARKET PLAYED OUT', subtitle: s.outcome.summary };
  }, [phase, replay, exitShown, finished, s]);

  const lessonSaved = !!attempt && lessons.some((l) => l.attemptId === attempt.id);

  return (
    <Screen header={<AppHeader title={mode === 'great' ? 'Great setups' : mode === 'smart' ? 'Smart practice' : 'Practice'} subtitle={`${s.instrument} · ${s.strategyName}`} back />}>
      {reason ? (
        <Card tone="accent">
          <View style={styles.row}>
            <Ionicons name="sparkles" size={16} color={colors.accentBright} />
            <AppText variant="label" tone="accent">
              {mode === 'great' ? 'Great setups' : 'Prop Guard selected this scenario because'}
            </AppText>
          </View>
          <AppText variant="body" style={{ marginTop: spacing.xs }}>
            {reason}
          </AppText>
        </Card>
      ) : null}

      <View style={styles.badges}>
        <StatusBadge label={s.instrument} size="sm" />
        <StatusBadge label={s.strategyName} tone="accent" size="sm" />
        <StatusBadge label={s.session === 'morning' ? 'Morning' : 'Afternoon'} size="sm" />
        <StatusBadge label={s.difficulty} size="sm" />
        <StatusBadge label="Educational sample" tone="warning" icon="information-circle-outline" size="sm" />
      </View>

      <Card>
        <PracticeChart
          key={run}
          scenario={s}
          visibleCount={visibleCount}
          user={phase === 'decide' ? null : user}
          ideal={finished && s.idealTrade ? s.idealTrade : null}
          exitIndex={phase === 'replay' ? replay?.exitIndex : null}
        />
        <View style={styles.context}>
          <Context label="HTF bias" value={BIAS_LABEL[s.marketContext.higherTimeframeBias]} />
          <Context label="Volatility" value={s.marketContext.volatility} />
          <Context label="Chart" value="5-minute" />
        </View>
        {finished && s.idealTrade ? (
          <AppText variant="caption" style={{ marginTop: spacing.sm }}>
            Dotted lines show the ideal entry, stop and target.
          </AppText>
        ) : null}
      </Card>

      {phase === 'decide' ? (
        <>
          {template ? (
            <Card>
              <AppText variant="label">Your {template.shortName} rules</AppText>
              <View style={{ marginTop: spacing.sm }}>
                <RuleChecklist rows={template.checklist.map((c) => ({ id: c, label: c, state: 'pending' as const }))} />
              </View>
            </Card>
          ) : null}
          <PracticeDecision key={run} instrument={s.instrument} lastClose={s.candles[s.decisionIndex].close} onSubmit={submit} />
        </>
      ) : null}

      {score && phase === 'scored' ? (
        <>
          <PracticeScoreCard score={score} />
          {mode === 'great' && s.badges.length ? <GreatBadges badges={s.badges} /> : null}
          <Button label="Play Market" icon="play" onPress={startReplay} accessibilityHint="Reveals the rest of the session candle by candle" />
        </>
      ) : null}

      {phase === 'replay' ? (
        <>
          {banner ? <VerdictBanner tone={banner.tone} title={banner.title} subtitle={banner.subtitle} /> : null}
          <Card>
            <PracticeReplayControls
              playing={isPlaying}
              speed={speed}
              position={position}
              total={afterTotal}
              onPlayPause={() => setPlaying((p) => !p)}
              onPrev={() => {
                setPlaying(false);
                setPosition((p) => Math.max(0, p - 1));
              }}
              onNext={() => {
                setPlaying(false);
                setPosition((p) => Math.min(afterTotal, p + 1));
              }}
              onRestart={() => {
                setPosition(0);
                setPlaying(true);
              }}
              onSpeed={setSpeed}
            />
          </Card>
          {score && !finished ? (
            <AppText variant="caption" align="center">
              Your score: {score.total}/100 · {score.grade}. The full review appears when the replay ends.
            </AppText>
          ) : null}
        </>
      ) : null}

      {finished && score && attempt && replay ? (
        <>
          {mode === 'great' && s.badges.length ? <GreatBadges badges={s.badges} /> : null}
          <PracticeReview
            scenario={s}
            attempt={attempt}
            score={score}
            replay={replay}
            lessonSaved={lessonSaved}
            onSaveLesson={() =>
              saveLesson({
                id: uuid(),
                attemptId: attempt.id,
                scenarioId: s.id,
                strategyId: s.strategyId,
                strategyName: s.strategyName,
                instrument: s.instrument,
                score: attempt.score,
                grade: attempt.grade,
                lesson: s.lesson,
                createdAt: new Date().toISOString(),
              })
            }
            onPracticeAgain={practiceAgain}
            onNext={next}
          />
        </>
      ) : null}

      <AppText variant="caption" tone="tertiary">
        {SAMPLE_DATA_NOTE} {PRACTICE_DISCLAIMER}
      </AppText>
    </Screen>
  );
}

function Context({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText variant="label" style={{ fontSize: 10 }}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={{ textTransform: 'capitalize' }}>
        {value}
      </AppText>
    </View>
  );
}

function GreatBadges({ badges }: { badges: string[] }) {
  return (
    <Card tone="positive">
      <AppText variant="label" tone="positive">
        Why this was a strong setup
      </AppText>
      <View style={[styles.badges, { marginTop: spacing.sm }]}>
        {badges.map((b) => (
          <StatusBadge key={b} label={b} tone="positive" size="sm" />
        ))}
      </View>
      <AppText variant="caption" style={{ marginTop: spacing.sm }}>
        Illustrative example — badges describe the setup&apos;s structure, not a historical success rate.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  context: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
