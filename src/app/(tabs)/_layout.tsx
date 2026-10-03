import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/domain/TabBar';
import { colors } from '@/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="strategy" />
      <Tabs.Screen name="analyze" />
      <Tabs.Screen name="journal" />
      <Tabs.Screen name="performance" />
    </Tabs>
  );
}
