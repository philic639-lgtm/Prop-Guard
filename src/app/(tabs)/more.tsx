import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppHeader, Card, ListRow, Logo, Screen, SectionHeader } from '@/components/ui';
import type { IconName } from '@/components/ui/Icon';
import { spacing, type Tone } from '@/constants/theme';
import { useAppStore } from '@/store/useAppStore';

type Item = { title: string; subtitle: string; icon: IconName; route: string; tone?: Tone; value?: string };

/** More: every secondary destination, grouped, one tap each. */
export default function MoreTab() {
  const accounts = useAppStore((s) => s.accounts.length);
  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Trading',
      items: [
        { title: 'Risk Manager', subtitle: 'Daily risk, drawdown, rules and position size', icon: 'risk-manager', route: '/risk', tone: 'positive' },
        { title: 'Intelligence', subtitle: 'Scheduled economic releases (CPI, jobs, FOMC)', icon: 'economic-calendar', route: '/intelligence', tone: 'warning' },
        { title: 'Check a trade', subtitle: 'Risk + rules before you enter', icon: 'checkmark-done-outline', route: '/analyze', tone: 'accent' },
        { title: 'Setup Check', subtitle: 'Chart vs your strategy', icon: 'scan-outline', route: '/setup-check', tone: 'accent' },
        { title: 'Risk calculator', subtitle: 'Size from your stop', icon: 'calculator-outline', route: '/calculator', tone: 'accent' },
      ],
    },
    {
      title: 'Accounts',
      items: [
        { title: 'My Accounts', subtitle: 'All accounts, updates and rules', icon: 'accounts', route: '/accounts', tone: 'accent', value: String(accounts) },
        { title: 'Import from screenshot', subtitle: 'Read a dashboard screenshot', icon: 'account-import', route: '/accounts/import', tone: 'accent' },
      ],
    },
    {
      title: 'Review & improve',
      items: [
        { title: 'Performance', subtitle: 'From your journal', icon: 'analytics', route: '/performance', tone: 'positive' },
        { title: 'Discipline score', subtitle: 'Rules followed over time', icon: 'ribbon-outline', route: '/discipline', tone: 'positive' },
        { title: 'Practice', subtitle: 'Replay scenarios', icon: 'practice', route: '/practice', tone: 'positive' },
        { title: 'Learn', subtitle: 'Lessons and your trading plan', icon: 'school-outline', route: '/learn', tone: 'positive' },
        { title: 'Quick start', subtitle: 'Setup checklist', icon: 'flash-outline', route: '/start', tone: 'positive' },
      ],
    },
    {
      title: 'App',
      items: [
        { title: 'Settings', subtitle: 'Profile, preferences, notifications, data', icon: 'settings', route: '/profile' },
        { title: 'Alerts', subtitle: 'Entry, breakeven and risk alerts', icon: 'alerts', route: '/alerts' },
      ],
    },
  ];
  return (
    <Screen tabBar header={<AppHeader title="More" />}>
      <View style={styles.brand}>
        <Logo tagline />
      </View>
      {groups.map((g) => (
        <View key={g.title} style={styles.group}>
          <SectionHeader title={g.title} />
          <Card padded={false}>
            {g.items.map((i) => (
              <ListRow key={i.route} icon={i.icon} iconTone={i.tone ?? 'neutral'} title={i.title} subtitle={i.subtitle} value={i.value} onPress={() => router.push(i.route as never)} />
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { paddingVertical: spacing.sm },
  group: { gap: spacing.sm },
});
