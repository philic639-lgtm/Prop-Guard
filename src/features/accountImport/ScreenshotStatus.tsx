import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DetailTable, StatusBadge } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { drawdownBuffer, drawdownFloor } from '@/lib/engines/propRuleEngine';
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
  const floorDiff = rep.drawdownThreshold != null && floor != null && Math.abs(rep.drawdownThreshold - floor) > 1;
  return (
    <Card style={styles.gap}>
      <View style={styles.row}>
        <StatusBadge label="Screenshot updated" tone="accent" icon="camera-outline" size="sm" />
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
          ...(rep.balance != null ? [{ label: 'Balance on screenshot', value: money(rep.balance) }] : []),
          ...(rep.drawdownThreshold != null ? [{ label: 'Firm threshold on screenshot', value: money(rep.drawdownThreshold) }] : []),
          { label: 'Drawdown floor (account rules)', value: floor != null ? money(floor) : 'No drawdown rule', tone: floorDiff ? 'warning' : 'primary' },
          { label: 'Drawdown remaining now', value: buffer != null ? money(buffer) : '—', bold: true },
        ]}
      />
      {floorDiff ? (
        <AppText variant="caption" tone="warning">
          The firm’s threshold differs from the account’s rules — check the drawdown settings.
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
