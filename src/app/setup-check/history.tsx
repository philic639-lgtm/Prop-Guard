import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Card, EmptyState, Screen, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { DECISION_UI } from '@/features/setupCheck/SetupCheckResult';
import { setupCheckOutcomes } from '@/lib/engines';
import { useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';

/** Saved Setup Checks + how QUALIFIED vs WAIT / STAND DOWN setups that were taken turned out. */
export default function SetupCheckHistory() {
  const checks = useAppStore((s) => s.setupChecks);
  const trades = useAppStore((s) => s.trades);
  const buckets = useMemo(() => setupCheckOutcomes(checks, trades), [checks, trades]);

  if (!checks.length) {
    return (
      <Screen header={<AppHeader title="Saved setup checks" back />}>
        <EmptyState icon="scan-outline" title="No saved setup checks" message="Save a Setup Check to track how often you trade QUALIFIED setups." actionLabel="New setup check" onAction={() => router.replace('/setup-check')} />
      </Screen>
    );
  }

  return (
    <Screen header={<AppHeader title="Saved setup checks" back />}>
      <Card>
        <AppText variant="label">Decision vs what you did</AppText>
        {buckets.map((b) => (
          <View key={b.decision} style={styles.row}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {DECISION_UI[b.decision].emoji} {DECISION_UI[b.decision].title}
            </AppText>
            <AppText variant="caption">
              {b.checks} checked · {b.taken} taken{b.closed ? ` · ${b.wins}/${b.closed} closed green · ${money(b.netPnl)}` : ''}
            </AppText>
          </View>
        ))}
        <AppText variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
          Process tracking — whether you traded your own QUALIFIED setups. Past results are not a forecast.
        </AppText>
      </Card>
      {checks.map((c) => {
        const d = DECISION_UI[c.decision];
        return (
          <Card key={c.id} onPress={() => router.push({ pathname: '/setup-check/[id]', params: { id: c.id } })}>
            <View style={styles.row}>
              <AppText variant="bodyStrong" style={styles.flex}>
                {d.emoji} {d.title}
              </AppText>
              <StatusBadge label={`Rules ${c.ruleAlignmentScore}%`} tone={d.tone} size="sm" />
            </View>
            <AppText variant="caption">
              {c.strategyName} · {c.instrument} · {new Date(c.createdAt).toLocaleString()}
              {c.tradeId ? ' · trade linked' : ''}
              {c.analysisMode === 'DEMO' ? ' · DEMO' : ''}
            </AppText>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
