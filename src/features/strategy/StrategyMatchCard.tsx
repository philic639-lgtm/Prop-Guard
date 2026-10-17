import { StyleSheet, View } from 'react-native';

import { AppText, Card, RuleChecklist, VerdictBanner } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useDailyGuard } from '@/hooks/useAppData';
import { useNow } from '@/hooks/useNow';
import { preTradeStatus, type PreTradeVerdict } from '@/lib/engines';
import type { Strategy } from '@/types/domain';

const VERDICT: Record<PreTradeVerdict, { title: string; tone: 'positive' | 'warning' | 'danger'; icon: 'checkmark-circle' | 'time' | 'close-circle' }> = {
  VALID: { title: 'SETUP VALID', tone: 'positive', icon: 'checkmark-circle' },
  WAIT: { title: 'WAIT', tone: 'warning', icon: 'time' },
  INVALID: { title: 'SETUP INVALID', tone: 'danger', icon: 'close-circle' },
};

interface StrategyMatchCardProps {
  strategy: Strategy;
  answers: Record<string, boolean | null | undefined>;
  invalidated?: boolean;
  /** Compact: banner + missing items only. */
  compact?: boolean;
}

/**
 * STRATEGY MATCH — which of the trader's own rules are met, which are missing,
 * and whether the plan says VALID, WAIT or INVALID. Rule compliance, never a forecast.
 */
export function StrategyMatchCard({ strategy, answers, invalidated, compact }: StrategyMatchCardProps) {
  const guard = useDailyGuard();
  const now = useNow(30_000);
  const st = preTradeStatus({ strategy, answers, guard, now, invalidated });
  const v = VERDICT[st.verdict];
  const matched = st.checks.filter((c) => c.state === 'met');
  const missing = st.checks.filter((c) => c.state !== 'met');

  return (
    <View style={{ gap: spacing.md }}>
      <VerdictBanner tone={v.tone} title={v.title} subtitle={st.reasons[0]} badge={`${st.met}/${st.total}`} icon={v.icon} />
      <Card>
        <AppText variant="label" style={{ marginBottom: spacing.sm }}>
          Strategy match · {strategy.name}
        </AppText>
        {!compact && matched.length > 0 ? (
          <>
            <AppText variant="caption" style={styles.sub}>
              Rules matched
            </AppText>
            <RuleChecklist rows={matched.map((c) => ({ id: c.id, label: c.label, state: 'pass' as const }))} />
          </>
        ) : null}
        {missing.length > 0 ? (
          <>
            <AppText variant="caption" style={[styles.sub, !compact && matched.length > 0 && { marginTop: spacing.md }]}>
              Missing
            </AppText>
            <RuleChecklist
              rows={missing.map((c) => ({
                id: c.id,
                label: c.label,
                state: c.state === 'unanswered' ? ('warn' as const) : ('fail' as const),
                detail: c.state === 'unanswered' ? 'Not confirmed yet' : c.auto ? 'Checked from your limits' : 'Not met',
              }))}
            />
          </>
        ) : null}
        {st.reasons.length > 1 ? (
          <View style={{ marginTop: spacing.md, gap: 4 }}>
            {st.reasons.slice(1).map((r) => (
              <AppText key={r} variant="caption">
                • {r}
              </AppText>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { marginBottom: spacing.xs, fontWeight: '700' },
});
