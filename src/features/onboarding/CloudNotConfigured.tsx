import { router } from 'expo-router';

import { AppText, Button, Card } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useAppStore } from '@/store/useAppStore';

/** Shown on auth screens when Supabase keys are absent (Demo Mode). */
export function CloudNotConfigured({ next }: { next?: string }) {
  const loadDemo = useAppStore((s) => s.loadDemo);
  return (
    <Card tone="accent">
      <AppText variant="label" tone="accent">
        Demo mode
      </AppText>
      <AppText variant="body" style={{ marginTop: spacing.sm }}>
        Cloud accounts aren&apos;t configured for this build. Add your Supabase keys to .env to enable sign-in and sync. Everything else works on this device.
      </AppText>
      <Button label="Continue on this device" style={{ marginTop: spacing.lg }} onPress={() => router.replace(next === 'onboarding' ? '/onboarding/markets' : '/onboarding/welcome')} />
      <Button
        label="Explore the demo"
        variant="ghost"
        onPress={() => {
          loadDemo();
          router.dismissAll();
          router.replace('/home');
        }}
      />
    </Card>
  );
}
