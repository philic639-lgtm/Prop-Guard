import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/domain/TabBar';
import { colors } from '@/constants/theme';

/**
 * Five primary destinations: Home, Strategies, Copy Trade, Journal, More.
 * Analyze (trade check) and Performance stay tab routes so existing links
 * keep working; they are reached from the dashboard and More, not the bar.
 */
export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="strategy" />
      <Tabs.Screen name="copy" />
      <Tabs.Screen name="journal" />
      <Tabs.Screen name="more" />
      <Tabs.Screen name="analyze" />
      <Tabs.Screen name="performance" />
    </Tabs>
  );
}
