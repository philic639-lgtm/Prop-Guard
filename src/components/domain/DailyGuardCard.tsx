import { StyleSheet, View } from 'react-native';

import { AppText, Card, Metric, RiskProgress, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import type { DailyGuard } from '@/lib/engines/dailyGuardEngine';
import { formatDuration } from '@/utils/dates';
import { money, pct } from '@/utils/format';

import { GUARD_UI } from './guardUi';

interface DailyGuardCardProps {
  guard: DailyGuard;
  onPress?: () => void;
  detailed?: boolean;
  contractLabel?: string;
}

export function DailyGuardCard({ guard, onPress, detailed, contractLabel }: DailyGuardCardProps) {
  const ui = GUARD_UI[guard.status];
  return (
    <Card tone={ui.tone} onPress={onPress} accessibilityLabel={`Daily Guard: ${guard.headline}`}>
      <View style={styles.head}>
        <StatusBadge label={guard.status === 'CAUTION' ? guard.headline : ui.label} tone={ui.tone} icon={ui.icon} size="lg" />
        {guard.cooldown.active ? (
          <AppText variant="number" tone="warning" accessibilityLabel={`Cooldown ${formatDuration(guard.cooldown.remainingMs)} remaining`}>
            {formatDuration(guard.cooldown.remainingMs)}
          </AppText>
        ) : null}
      </View>

      {guard.status === 'STOP' ? (
        <View style={styles.stop}>
          <AppText variant="heading">{guard.reasons[0]}</AppText>
          <AppText variant="caption">Prop Guard recommends ending today&apos;s session.</AppText>
        </View>
      ) : null}

      <View style={styles.block}>
        <View style={styles.rowBetween}>
          <AppText variant="label">Daily risk used</AppText>
          <AppText variant="caption" tone="secondary">
            {pct(guard.riskUsedPct)}
          </AppText>
        </View>
        <AppText variant="display">
          {money(guard.riskUsed)}
          <AppText variant="number" tone="tertiary"> / {money(guard.dailyLimit)}</AppText>
        </AppText>
        <RiskProgress value={guard.riskUsedPct} label="Daily risk used" />
      </View>

      <View style={styles.metrics}>
        <Metric label="Trades" value={`${guard.tradesTaken} / ${guard.maxTrades}`} compact />
        <Metric label="Risk left" value={money(guard.riskRemaining)} tone={guard.riskRemaining <= 0 ? 'danger' : undefined} compact />
        {detailed ? (
          <Metric label="DD buffer" value={money(guard.drawdownBuffer)} compact />
        ) : (
          <Metric label="Today P/L" value={money(guard.realizedPnlToday, { sign: true })} tone={guard.realizedPnlToday >= 0 ? 'positive' : 'danger'} compact />
        )}
      </View>

      {detailed ? (
        <View style={styles.metrics}>
          <Metric label="Trades left" value={String(guard.tradesRemaining)} compact />
          <Metric label="Loss streak" value={String(guard.consecutiveLosses)} compact />
          <Metric label="Max size" value={contractLabel ?? (guard.maxContracts ? String(guard.maxContracts) : '—')} compact />
        </View>
      ) : null}

      {guard.status === 'CAUTION' && guard.reasons.length > 0 ? (
        <View style={styles.reasons}>
          {guard.reasons.map((r) => (
            <AppText key={r} variant="caption" tone="warning">
              • {r}
            </AppText>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stop: { marginTop: spacing.lg, gap: spacing.xs },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  metrics: { flexDirection: 'row', marginTop: spacing.lg, gap: spacing.md },
  reasons: { marginTop: spacing.md, gap: 2 },
});
