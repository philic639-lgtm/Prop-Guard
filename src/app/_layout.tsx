import { DarkTheme, router, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Button, ErrorState } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { useBootstrap } from '@/hooks/useBootstrap';
import { useNotificationRouting } from '@/hooks/useNotificationRouting';
import { useAppStore } from '@/store/useAppStore';

void SplashScreen.preventAutoHideAsync();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.accent, text: colors.text },
};

/** Crash screen for any route below: retry, or get back to Home — never a blank app. Raw error text stays out of the UI. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.lg }}>
      <ErrorState message="This screen could not be shown. Your accounts and journal on this device are unchanged." onRetry={() => void retry()} />
      <Button label="Go to Home" variant="ghost" onPress={() => router.replace('/')} />
    </View>
  );
}

export default function RootLayout() {
  const hydrated = useAppStore((s) => s.hydrated);
  useBootstrap();
  useNotificationRouting(hydrated);

  useEffect(() => {
    if (hydrated) void SplashScreen.hideAsync();
  }, [hydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          {hydrated ? (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              <Stack.Screen name="session/check" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="session/loss" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              <Stack.Screen name="strategy/generating" options={{ animation: 'fade', gestureEnabled: false }} />
            </Stack>
          ) : null}
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
