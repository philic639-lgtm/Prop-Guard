import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DetailTable, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { FIELD_LABEL, type FieldKey } from '@/lib/engines/accountImport';
import { dailyLossLimitFor, drawdownBuffer, drawdownFloor, maxDrawdownAmount, ruleFloor } from '@/lib/engines/propRuleEngine';
import type { Account } from '@/types/domain';
import { money } from '@/utils/format';

export function screenshotLabel(at: string): string {
  const d = new Date(at);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

/** Account dashboard card: last confirmed screenshot values vs Prop Guard's calculation, history, update button. */
export function ScreenshotStatus({ account }: { account: Account }) {
  const st = account.importState;
  const rep = st?.reported;
  const floor = drawdownFloor(account);
  const buffer = drawdownBuffer(account);
  const update = () => router.push({ pathname: '/accounts/import', params: { accountId: account.id } });
  if (!rep) {
    return (
      <Card style={styles.gap}>
        <AppText variant="bodyStrong">Update from a screenshot</AppText>
        <AppText variant="caption">Upload your firm dashboard to update the balance and drawdown — you review every value first.</AppText>
        <Button label="Import account screenshot" icon="camera-outline" variant="secondary" onPress={update} />
      </Card>
    );
  }
  // The firm's own floor vs what the account's rules alone would calculate (a mismatch means the rules need a look).
  const fromRules = ruleFloor(account);
  const floorDiff = rep.drawdownThreshold != null && fromRules != null && Math.abs(rep.drawdownThreshold - fromRules) > 1;
  const maxLoss = maxDrawdownAmount(account);
  // Where a confirmed value came from: read on the screenshot, or typed by the trader during the import.
  const enteredByYou = (k: string) => st?.history[0]?.fields.find((f) => f.key === k)?.source === 'user';
  const dll = dailyLossLimitFor(account);
  const target = account.rules.profitTarget;
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <StatusBadge label="Snapshot-based — not live verified" tone="accent" icon="camera-outline" size="sm" />
        <AppText variant="caption" style={styles.flex}>
          {screenshotLabel(rep.at)}
          {st?.maskedId ? ` · ${st.maskedId}` : ''}
        </AppText>
      </View>
      <AppText variant="caption" tone="tertiary">
        Confirmed from your dashboard screenshot — not a live connection. Trades journaled since then update the balance.
      </AppText>
      <DetailTable
        rows={[
          ...(rep.balance != null ? [{ label: enteredByYou('balance') ? 'Balance (entered by you)' : 'Balance on screenshot', value: money(rep.balance) }] : []),
          ...(rep.drawdownThreshold != null ? [{ label: enteredByYou('drawdownThreshold') ? 'Liquidation threshold (entered by you)' : 'Liquidation threshold (MLL) on screenshot', value: money(rep.drawdownThreshold) }] : []),
          { label: 'Current drawdown floor', value: floor != null ? money(floor) : 'Unknown', tone: floorDiff ? 'warning' : 'primary' },
          { label: 'Remaining drawdown now', value: buffer != null ? money(buffer) : 'Unknown', bold: true },
          { label: 'Max loss allowance', value: maxLoss != null ? money(maxLoss) : 'Unknown' },
          { label: 'Daily loss limit', value: dll?.mode === 'none' ? 'None' : dll?.limit != null ? money(dll.limit) : 'Unknown' },
          { label: 'Profit target', value: target != null ? `${money(target)} (balance ${money(account.startingBalance + target)})` : 'Unknown' },
          ...(rep.netPnl != null ? [{ label: 'Total P&L on screenshot', value: money(rep.netPnl, { sign: true }) }] : []),
          ...(rep.tradingDays != null ? [{ label: 'Trading days on screenshot', value: String(rep.tradingDays) }] : []),
        ]}
      />
      {rep.missing?.length ? (
        <AppText variant="caption" tone="tertiary">
          Not in the snapshot (unknown): {rep.missing.map((k) => FIELD_LABEL[k as FieldKey] ?? k).join(', ')}.
        </AppText>
      ) : null}
      {floorDiff ? (
        <AppText variant="caption" tone="warning">
          The firm’s minimum balance differs from what the account’s rules alone would calculate ({money(fromRules)}) — the firm’s value is used; check the drawdown settings.
        </AppText>
      ) : null}
      {st && st.history.length > 1 ? (
        <AppText variant="caption" tone="tertiary">
          {st.history.length} confirmed updates · previous {screenshotLabel(st.history[1].at)}
        </AppText>
      ) : null}
      <Button label="Update from screenshot" icon="camera-outline" variant="secondary" onPress={update} />
    </Card>
  );
}

const styles = StyleSheet.create({ gap: { gap: spacing.sm }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, flex: { flex: 1 } });
