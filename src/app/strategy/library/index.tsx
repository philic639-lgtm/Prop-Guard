import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Disclaimer } from '@/components/domain/Disclaimer';
import { AppHeader, AppText, Card, Screen, StatusBadge } from '@/components/ui';
import { PLANS } from '@/config/plans';
import { LIBRARY_DISCLAIMER } from '@/constants/legal';
import { colors, spacing } from '@/constants/theme';
import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

export default function LibraryScreen() {
  const plan = useSubscriptionStore((s) => s.plan);
  const limit = PLANS[plan].limits.libraryTemplates;
  return (
    <Screen header={<AppHeader title="Strategy library" subtitle="Educational templates" back />}>
      <AppText variant="caption">{LIBRARY_DISCLAIMER}</AppText>
      {STRATEGY_LIBRARY.map((t, i) => {
        const locked = i >= limit;
        return (
          <Card key={t.id} onPress={() => router.push(locked ? '/paywall' : { pathname: '/strategy/library/[id]', params: { id: t.id } })}>
            <View style={styles.head}>
              <AppText variant="heading" style={styles.flex}>
                {t.name}
              </AppText>
              {locked ? <Ionicons name="lock-closed" size={16} color={colors.textTertiary} /> : <StatusBadge label={t.complexity} size="sm" />}
            </View>
            <AppText variant="caption" style={{ marginTop: spacing.xs }} numberOfLines={2}>
              {t.summary}
            </AppText>
            <AppText variant="label" style={{ marginTop: spacing.md, fontSize: 10 }}>
              {t.markets.join(' · ')} · {t.session}
            </AppText>
          </Card>
        );
      })}
      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
