import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LiveTradeChart } from '@/components/charts/LiveTradeChart';
import { ProGate } from '@/components/domain/ProGate';
import {
  AppHeader,
  AppText,
  Button,
  Card,
  CircularScore,
  EmptyState,
  FieldRow,
  Screen,
  SectionHeader,
  SelectField,
  StatusBadge,
  VerdictBanner,
  YesNo,
} from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useActiveStrategy } from '@/hooks/useAppData';
import { aiService } from '@/services/ai';
import { pickScreenshot } from '@/services/screenshotService';
import { useAppStore } from '@/store/useAppStore';
import type { PracticeRun } from '@/types/domain';
import { shortDate, time } from '@/utils/format';
import { uuid } from '@/utils/id';

const SAMPLE = [6731.25, 6733, 6736.5, 6735.25, 6738, 6741.75, 6744, 6742.5, 6741.75, 6742.25, 6743.5, 6746, 6748.25, 6747.5, 6750];

const VERDICT_UI = {
  match: { tone: 'positive' as const, title: 'Strategy match', subtitle: 'In live trading you would be cleared to enter' },
  wait: { tone: 'warning' as const, title: 'Wait', subtitle: 'One condition is not confirmed' },
  no_trade: { tone: 'danger' as const, title: 'No trade', subtitle: 'This is not your setup' },
};

/** Practice a saved strategy on your own screenshots before risking capital. */
export default function ScreenshotPracticeScreen() {
  const params = useLocalSearchParams<{ strategyId?: string }>();
  const strategies = useAppStore((s) => s.strategies);
  const runs = useAppStore((s) => s.practiceRuns);
  const addRun = useAppStore((s) => s.addPracticeRun);
  const demo = useAppStore((s) => s.mode === 'demo');
  const active = useActiveStrategy();
  const [strategyId, setStrategyId] = useState<string | null>(params.strategyId ?? active?.id ?? null);
  const [image, setImage] = useState<string | null | 'sample'>(null);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<PracticeRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strategy = strategies.find((s) => s.id === strategyId) ?? null;
  const items = useMemo(() => strategy?.checklist.filter((c) => c.kind === 'yesno') ?? [], [strategy]);
  const history = runs.filter((r) => !strategyId || r.strategyId === strategyId).slice(0, 8);
  const answered = items.every((i) => answers[i.id] != null);

  const pick = async () => {
    setError(null);
    const r = await pickScreenshot('library');
    if (r.status === 'ok') {
      setImage(r.image.uri);
      setResult(null);
      setAnswers({});
    } else if (r.status === 'denied') setError('Photo access is required. Enable it in Settings.');
    else if (r.status === 'error') setError(r.message);
  };

  const analyze = async () => {
    if (!strategy) return;
    setLoading(true);
    try {
      const conditions = items.map((i) => ({ label: i.label, met: answers[i.id] === true }));
      const met = conditions.filter((c) => c.met).length;
      const total = conditions.length;
      const missing = total - met;
      const { feedback } = await aiService.practiceFeedback({ strategyName: strategy.name, conditions });
      const run: PracticeRun = {
        id: uuid(),
        strategyId: strategy.id,
        screenshotUri: image === 'sample' ? null : image,
        answers,
        matchPct: total ? Math.round((met / total) * 100) : 0,
        conditionsMet: met,
        conditionsTotal: total,
        verdict: missing === 0 ? 'match' : missing === 1 ? 'wait' : 'no_trade',
        feedback,
        createdAt: new Date().toISOString(),
      };
      addRun(run);
      setResult(run);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen header={<AppHeader title="Chart practice" subtitle="Your own screenshots" back />}>
      <ProGate feature="practiceMode" title="Practice mode" description="Test a saved strategy on screenshots before using it live — no capital at risk.">
        {strategies.length === 0 ? (
          <EmptyState icon="git-branch-outline" title="No strategy to practice" message="Save a strategy first, then practice spotting it on charts." actionLabel="Build a strategy" onAction={() => router.replace('/strategy')} />
        ) : (
          <>
            <Card>
              <View style={styles.row}>
                <Ionicons name="school" size={18} color={colors.accentBright} />
                <AppText variant="body" style={styles.flex}>
                  Practice spotting your setup. Nothing here is a real trade and nothing affects your account.
                </AppText>
              </View>
              <View style={{ marginTop: spacing.md }}>
                <FieldRow
                  label="Strategy"
                  control={
                    <SelectField
                      label="Strategy"
                      value={strategyId}
                      options={strategies.map((s) => ({ value: s.id, label: s.name }))}
                      onChange={(v) => {
                        setStrategyId(v);
                        setAnswers({});
                        setResult(null);
                      }}
                    />
                  }
                />
              </View>
            </Card>

            {image ? (
              <Card>
                <View style={styles.row}>
                  <AppText variant="label" style={styles.flex}>
                    {image === 'sample' ? 'Sample chart · ES 5m' : 'Your screenshot'}
                  </AppText>
                  <Button label="Change" variant="ghost" size="md" onPress={() => { setImage(null); setResult(null); }} />
                </View>
                {image === 'sample' ? (
                  <LiveTradeChart prices={SAMPLE} entry={6742.25} stop={6737.25} target={6752.25} height={180} />
                ) : (
                  <Image source={{ uri: image }} style={styles.preview} contentFit="contain" accessibilityLabel="Practice screenshot" />
                )}
              </Card>
            ) : (
              <Card>
                <View style={styles.drop}>
                  <Ionicons name="cloud-upload-outline" size={32} color={colors.accentBright} />
                  <AppText variant="heading">Upload a chart</AppText>
                  <AppText variant="caption" align="center">
                    Use a past chart from TradingView, Tradovate or NinjaTrader.
                  </AppText>
                </View>
                <Button label="Upload screenshot" icon="images-outline" onPress={() => void pick()} />
                {demo ? <Button label="Use a sample chart" variant="ghost" size="md" onPress={() => setImage('sample')} /> : null}
                {error ? (
                  <AppText variant="caption" tone="danger">
                    {error}
                  </AppText>
                ) : null}
              </Card>
            )}

            {image && strategy ? (
              <>
                <SectionHeader title={`${strategy.name} conditions`} />
                <Card>
                  <View style={{ gap: spacing.lg }}>
                    {items.map((i) => (
                      <YesNo key={i.id} label={i.label} value={answers[i.id] ?? null} onChange={(v) => { setAnswers((a) => ({ ...a, [i.id]: v })); setResult(null); }} />
                    ))}
                  </View>
                </Card>
                <Button label="Analyze practice setup" icon="sparkles" loading={loading} disabled={!answered || items.length === 0} onPress={() => void analyze()} />
              </>
            ) : null}

            {result ? (
              <>
                <View style={styles.score}>
                  <CircularScore value={result.matchPct} suffix="%" tone={VERDICT_UI[result.verdict].tone} size={130} label="Match" />
                </View>
                <VerdictBanner tone={VERDICT_UI[result.verdict].tone} title={VERDICT_UI[result.verdict].title} subtitle={VERDICT_UI[result.verdict].subtitle} badge={`${result.conditionsMet}/${result.conditionsTotal}`} />
                <Card>
                  <View style={styles.row}>
                    <Ionicons name="sparkles" size={16} color={colors.accentBright} />
                    <AppText variant="label" tone="accent">
                      AI feedback
                    </AppText>
                  </View>
                  <AppText variant="body" style={{ marginTop: spacing.sm }}>
                    {result.feedback}
                  </AppText>
                </Card>
              </>
            ) : null}

            <SectionHeader title="Practice history" />
            {history.length === 0 ? (
              <AppText variant="caption">Your practice attempts will appear here.</AppText>
            ) : (
              <Card>
                {history.map((r, i) => {
                  const ui = VERDICT_UI[r.verdict];
                  return (
                    <View key={r.id} style={[styles.hist, i > 0 && styles.border]}>
                      <StatusBadge label={`${r.conditionsMet}/${r.conditionsTotal}`} tone={ui.tone} size="sm" />
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">{ui.title}</AppText>
                        <AppText variant="caption" numberOfLines={2}>
                          {r.feedback}
                        </AppText>
                      </View>
                      <AppText variant="caption" tone="tertiary">
                        {shortDate(r.createdAt)}
                        {'\n'}
                        {time(r.createdAt)}
                      </AppText>
                    </View>
                  );
                })}
              </Card>
            )}
          </>
        )}
      </ProGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  drop: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent + '88', borderRadius: radius.md, marginBottom: spacing.lg, backgroundColor: '#0B1730' },
  preview: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surface },
  score: { alignItems: 'center' },
  hist: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
