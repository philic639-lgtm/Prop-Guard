import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, AppText, Card, EmptyState, ListRow, MetricTile, RiskProgress, Screen, SectionHeader, StatusBadge, TileGrid } from '@/components/ui';
import { GUARD_UI } from '@/components/domain/guardUi';
import type { IconName } from '@/components/ui/Icon';
import { spacing } from '@/constants/theme';
import { useActiveAccount, useDailyGuard } from '@/hooks/useAppData';
import { LIMIT_SOURCE_LABEL, LIMIT_SOURCE_SHORT } from '@/lib/engines/dailyGuardEngine';
import { drawdownFloor } from '@/lib/engines/propRuleEngine';
import { useAppStore } from '@/store/useAppStore';
import { money } from '@/utils/format';

/**
 * Risk Manager: today's risk state for the active account (from the Daily
 * Guard — the same numbers as the dashboard) and the tools that set it.
 */
export default function RiskManager() {
  const account = useActiveAccount();
  const guard = useDailyGuard(true);
  const rules = useAppStore((s) => s.tradingRules);
  const links: { title: string; subtitle: string; icon: IconName; route: string }[] = [
    { title: 'Trading rules', subtitle: `${money(rules.maxRiskPerTrade)} / trade · ${money(rules.dailyStop)} daily stop · ${rules.maxTradesPerDay} trades`, icon: 'rules-drawdown', route: '/settings/rules' },
    { title: 'Position size calculator', subtitle: 'Contracts from your stop and risk', icon: 'calculator-outline', route: '/calculator' },
    { title: 'Check a trade', subtitle: 'Risk + rules before entry', icon: 'checkmark-done-outline', route: '/analyze' },
    { title: 'Account limits', subtitle: account ? account.name : 'Add an account', icon: 'accounts', route: account ? `/accounts/${account.id}` : '/accounts/new' },
  ];
  return (
    <Screen header={<AppHeader title="Risk Manager" subtitle={account?.name ?? 'No account'} back />}>
      {!account || !guard ? (
        <Card>
          <EmptyState illustration="shield" title="Add your trading account" message="Risk Manager needs your account limits." actionLabel="Add account" onAction={() => router.push('/accounts/new')} />
        </Card>
      ) : (
        <>
          <Card accent={GUARD_UI[guard.status].tone} style={styles.gap}>
            <StatusBadge label={guard.status === 'CAUTION' ? guard.headline : GUARD_UI[guard.status].label} tone={GUARD_UI[guard.status].tone} icon={GUARD_UI[guard.status].icon} />
            {guard.dailyLimit > 0 ? (
              <>
                <AppText variant="caption">
                  {money(guard.riskUsed)} of {money(guard.dailyLimit)} daily risk used · limit: {LIMIT_SOURCE_LABEL[guard.dailyLimitSource]}
                </AppText>
                <RiskProgress value={guard.riskUsedPct} label="Daily risk used" />
              </>
            ) : null}
            {guard.reasons[0] ? (
              <AppText variant="caption" tone="secondary">
                {guard.reasons[0]}
              </AppText>
            ) : null}
          </Card>
          <TileGrid>
            <MetricTile label="Risk left today" value={guard.riskRemainingSource === 'none' ? 'Not set' : money(guard.riskRemaining)} sub={guard.riskRemainingSource === 'none' ? 'Set a daily stop' : `Limit: ${LIMIT_SOURCE_SHORT[guard.riskRemainingSource]}`} icon="shield-half-outline" />
            <MetricTile label="Drawdown remaining" value={guard.drawdownUnknown ? 'Unknown' : money(guard.drawdownBuffer)} sub={drawdownFloor(account) != null ? `Floor ${money(drawdownFloor(account))}` : guard.drawdownUnknown ? 'Add the liquidation threshold' : undefined} tone={guard.drawdownUnknown ? 'warning' : 'primary'} />
            <MetricTile label="Trades left" value={`${guard.tradesRemaining} / ${guard.maxTrades}`} />
            <MetricTile label="Max contracts" value={guard.maxContracts != null ? String(guard.maxContracts) : 'Not set'} />
          </TileGrid>
        </>
      )}
      <SectionHeader title="Tools" />
      <Card padded={false}>
        {links.map((l) => (
          <ListRow key={l.title} icon={l.icon} iconTone="accent" title={l.title} subtitle={l.subtitle} onPress={() => router.push(l.route as never)} />
        ))}
      </Card>
      <View style={styles.pad} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: spacing.sm },
  pad: { height: spacing.lg },
});
