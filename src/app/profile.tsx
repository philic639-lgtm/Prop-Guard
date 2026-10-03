import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { AppHeader, AppText, Card, ConfirmationSheet, Divider, ListRow, Screen, SectionHeader, StatusBadge } from '@/components/ui';
import { isDemoMode } from '@/config/env';
import { PLANS } from '@/config/plans';
import { SUPPORT_EMAIL } from '@/constants/legal';
import { colors, radius, spacing } from '@/constants/theme';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import { money } from '@/utils/format';

export default function ProfileScreen() {
  const prefs = useAppStore((s) => s.preferences);
  const user = useAppStore((s) => s.user);
  const mode = useAppStore((s) => s.mode);
  const accounts = useAppStore((s) => s.accounts);
  const rules = useAppStore((s) => s.tradingRules);
  const signOutLocal = useAppStore((s) => s.signOutLocal);
  const plan = useSubscriptionStore((s) => s.plan);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const initials = (prefs.displayName || prefs.email || 'PG')
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  const modeLabel = mode === 'cloud' ? 'Synced' : mode === 'demo' ? 'Demo mode' : 'On this device';

  return (
    <Screen header={<AppHeader title="Profile & settings" back />}>
      <Card>
        <View style={styles.user}>
          <View style={styles.avatar}>
            <AppText variant="heading" tone="accent">
              {initials || 'PG'}
            </AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="heading">{prefs.displayName || 'Trader'}</AppText>
            <AppText variant="caption">{user?.email ?? prefs.email ?? 'Not signed in'}</AppText>
          </View>
        </View>
        <View style={styles.badges}>
          <StatusBadge label={PLANS[plan].name} tone={plan === 'pro' ? 'accent' : 'neutral'} icon={plan === 'pro' ? 'diamond' : undefined} size="sm" />
          <StatusBadge label={modeLabel} tone={mode === 'cloud' ? 'positive' : 'neutral'} size="sm" />
        </View>
      </Card>

      <SectionHeader title="Trading" />
      <Card padded={false} style={styles.group}>
        <ListRow icon="briefcase-outline" iconTone="accent" title="Prop accounts" value={String(accounts.length)} onPress={() => router.push('/accounts')} />
        <Divider />
        <ListRow icon="shield-checkmark-outline" iconTone="accent" title="Trading rules" subtitle={`${money(rules.maxRiskPerTrade)} / trade · ${rules.maxTradesPerDay} trades · ${money(rules.dailyStop)} daily stop`} onPress={() => router.push('/settings/rules')} />
        <Divider />
        <ListRow icon="options-outline" iconTone="accent" title="Trading preferences" subtitle={`Default ${prefs.defaultInstrument} · ${prefs.timezone}`} onPress={() => router.push('/settings/preferences')} />
        <Divider />
        <ListRow icon="calculator-outline" iconTone="accent" title="Risk calculator" onPress={() => router.push('/calculator')} />
      </Card>

      <SectionHeader title="Performance" />
      <Card padded={false} style={styles.group}>
        <ListRow icon="stats-chart-outline" iconTone="positive" title="Analytics" onPress={() => router.push('/performance')} />
        <Divider />
        <ListRow icon="ribbon-outline" iconTone="positive" title="Discipline score" onPress={() => router.push('/discipline')} />
        <Divider />
        <ListRow icon="sparkles-outline" iconTone="positive" title="AI session summary" onPress={() => router.push('/session/review')} />
        <Divider />
        <ListRow icon="school-outline" iconTone="positive" title="Practice mode" onPress={() => router.push('/practice')} />
      </Card>

      <SectionHeader title="App" />
      <Card padded={false} style={styles.group}>
        <ListRow icon="diamond-outline" title="Subscription" value={PLANS[plan].name} onPress={() => router.push('/paywall')} />
        <Divider />
        <ListRow icon="notifications-outline" title="Alerts" onPress={() => router.push('/alerts')} />
        <Divider />
        <ListRow icon="options-outline" title="Notification settings" onPress={() => router.push('/settings/notifications')} />
        <Divider />
        <ListRow icon="moon-outline" title="Appearance" value="Dark" chevron={false} />
        <Divider />
        <ListRow icon="download-outline" title="Data export" subtitle="Export or reset your data" onPress={() => router.push('/settings/data')} />
        <Divider />
        <ListRow icon="lock-closed-outline" title="Privacy & disclaimer" onPress={() => router.push('/settings/privacy')} />
        <Divider />
        <ListRow icon="help-circle-outline" title="Support" subtitle={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Prop%20Guard%20support`)} />
      </Card>

      <Card padded={false} style={styles.group}>
        {user ? (
          <ListRow icon="log-out-outline" title="Sign out" destructive onPress={() => setConfirmSignOut(true)} />
        ) : isDemoMode ? (
          <ListRow icon="person-add-outline" title={mode === 'demo' ? 'Set up my own account' : 'Restart onboarding'} onPress={() => router.push('/onboarding/welcome')} />
        ) : (
          <ListRow icon="log-in-outline" title="Sign in to sync" onPress={() => router.push('/auth/sign-in')} />
        )}
      </Card>

      <AppText variant="caption" tone="tertiary" align="center">
        Prop Guard v0.1.0 · Trade the plan. Protect the account.
      </AppText>
      <Disclaimer />

      <ConfirmationSheet
        visible={confirmSignOut}
        title="Sign out"
        message="Your data stays in your account. This device's local copy will be cleared."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setConfirmSignOut(false);
          await authService.signOut();
          signOutLocal();
          router.replace('/onboarding/welcome');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  user: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: 2 },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  group: { paddingHorizontal: spacing.lg },
});
