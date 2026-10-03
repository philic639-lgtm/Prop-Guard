import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Card } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import type { DailyGuard } from '@/lib/engines/dailyGuardEngine';
import { aiService, type DailyCoach } from '@/services/ai';

interface CoachCardProps {
  guard: DailyGuard;
  disciplineScore: number;
  strategyName: string | null;
  lastSetupMatchPct: number | null;
}

export function CoachCard({ guard, disciplineScore, strategyName, lastSetupMatchPct }: CoachCardProps) {
  const [coach, setCoach] = useState<DailyCoach | null>(null);
  const key = `${guard.status}|${guard.tradesTaken}|${Math.round(guard.riskRemaining)}|${guard.cooldown.active}|${lastSetupMatchPct}`;

  useEffect(() => {
    let alive = true;
    aiService
      .generateDailyCoach({
        guardStatus: guard.status,
        tradesTaken: guard.tradesTaken,
        maxTrades: guard.maxTrades,
        riskRemaining: guard.riskRemaining,
        consecutiveLosses: guard.consecutiveLosses,
        cooldownActive: guard.cooldown.active,
        lastSetupMatchPct,
        disciplineScore,
        strategyName,
      })
      .then((c) => alive && setCoach(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <Card>
      <View style={styles.head}>
        <Ionicons name="sparkles" size={16} color={colors.accent} />
        <AppText variant="label" tone="accent">
          AI Coach
        </AppText>
      </View>
      {coach ? (
        <>
          <AppText variant="body" style={styles.msg}>
            {coach.message}
          </AppText>
          <View style={styles.action}>
            <AppText variant="label" style={{ fontSize: 10 }}>
              Best action
            </AppText>
            <AppText variant="bodyStrong">{coach.bestAction}</AppText>
          </View>
        </>
      ) : (
        <AppText variant="caption" style={styles.msg}>
          Reviewing today&apos;s session…
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  msg: { marginTop: spacing.md },
  action: { marginTop: spacing.md, gap: 4, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
