import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, CircularScore, Screen } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useDailyGuard, useTrade } from '@/hooks/useAppData';
import { notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';
import { formatDuration } from '@/utils/dates';
import { money } from '@/utils/format';

/** Anti-revenge interstitial shown after every losing trade. */
export default function LossScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trade = useTrade(id);
  const guard = useDailyGuard(true);
  const rules = useAppStore((s) => s.tradingRules);
  const prefs = useAppStore((s) => s.preferences.notifications);

  const cooldown = guard?.cooldown;
  useEffect(() => {
    if (cooldown?.active) void notificationService.scheduleIn('cooldown', cooldown.remainingMs / 1000, prefs, 'cooldown');
    // Schedule once per screen visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const losses = guard?.consecutiveLosses ?? 0;
  const stop = guard?.status === 'STOP';
  const pctLeft = cooldown && cooldown.totalMs > 0 ? cooldown.remainingMs / cooldown.totalMs : 0;

  return (
    <Screen
      footer={
        <>
          <Button label="Journal this trade" icon="create-outline" onPress={() => router.replace({ pathname: '/journal/[id]', params: { id, edit: '1' } })} />
          {stop || losses >= 2 ? (
            <Button label="End session" variant="secondary" onPress={() => router.replace('/session/review')} />
          ) : (
            <Button label="Back to home" variant="ghost" onPress={() => router.replace('/home')} />
          )}
        </>
      }>
      <View style={styles.top}>
        <View style={styles.icon}>
          <Ionicons name="pause" size={26} color={colors.warning} />
        </View>
        <AppText variant="label" tone="warning">
          Loss recorded
        </AppText>
        <AppText variant="hero" tone="danger">
          {money(trade?.pnl)}
        </AppText>
        <AppText variant="heading" align="center">
          Take a moment.
        </AppText>
        <AppText variant="body" tone="secondary" align="center">
          A planned loss is part of the process. What you do next decides your day.
        </AppText>
      </View>

      {cooldown && cooldown.totalMs > 0 ? (
        <Card tone="warning">
          <AppText variant="caption" align="center">
            Your strategy requires a
          </AppText>
          <AppText variant="heading" tone="warning" align="center">
            {rules.cooldownMinutes} minute cooldown
          </AppText>
          <View style={styles.timer}>
            <CircularScore value={pctLeft * 100} tone="warning" size={170} stroke={10} label="Cooldown">
              <AppText variant="display" accessibilityLabel={`${formatDuration(cooldown.remainingMs)} remaining`}>
                {cooldown.active ? formatDuration(cooldown.remainingMs) : '00:00'}
              </AppText>
            </CircularScore>
          </View>
          <View style={styles.locked}>
            <Ionicons name={cooldown.active ? 'lock-closed' : 'lock-open'} size={16} color={cooldown.active ? colors.warning : colors.positive} />
            <AppText variant="label" tone={cooldown.active ? 'warning' : 'positive'}>
              {cooldown.active ? 'New trade locked' : 'Cooldown complete'}
            </AppText>
          </View>
        </Card>
      ) : null}

      {losses >= 2 || stop ? (
        <Card tone="danger">
          <AppText variant="label" tone="danger">
            {losses} losses
          </AppText>
          <AppText variant="heading" style={{ marginTop: spacing.xs }}>
            {stop ? guard?.reasons[0] : 'Prop Guard suggests ending the session.'}
          </AppText>
          <AppText variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
            Risk remaining: {money(guard?.riskRemaining)}
          </AppText>
        </Card>
      ) : (
        <Card>
          <AppText variant="body" tone="secondary">
            Risk remaining today: <AppText variant="bodyStrong">{money(guard?.riskRemaining)}</AppText> · Trades left:{' '}
            <AppText variant="bodyStrong">{guard?.tradesRemaining ?? 0}</AppText>
          </AppText>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  icon: { width: 60, height: 60, borderRadius: 20, backgroundColor: colors.warningMuted, alignItems: 'center', justifyContent: 'center' },
  timer: { alignItems: 'center', justifyContent: 'center', marginVertical: spacing.lg },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
});
