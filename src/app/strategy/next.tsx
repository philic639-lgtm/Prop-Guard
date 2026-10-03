import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { AppHeader, AppText, OptionCard, Screen } from '@/components/ui';
import { spacing } from '@/constants/theme';

/** After saving a strategy: practice it first, or go live. */
export default function StrategyNext() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <Screen header={<AppHeader title="Strategy saved" />}>
      <View style={{ gap: spacing.xs, marginTop: spacing.lg }}>
        <AppText variant="title" align="center">
          What would you like to do now?
        </AppText>
      </View>
      <OptionCard
        icon="school"
        title="Practice this strategy"
        description="Test it with screenshot analysis before using it for real trades."
        selected
        onPress={() => router.replace({ pathname: '/practice', params: id ? { strategyId: id } : {} })}
      />
      <OptionCard icon="stats-chart" title="Use this strategy" description="Start using this strategy for your live trading journal." onPress={() => router.replace('/home')} />
      <AppText variant="caption" align="center">
        You can always switch between practice and live mode later.
      </AppText>
    </Screen>
  );
}
