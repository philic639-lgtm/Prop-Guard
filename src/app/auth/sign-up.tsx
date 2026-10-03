import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AppHeader, AppText, Card, Screen } from '@/components/ui';
import { isDemoMode } from '@/config/env';
import { AuthForm, type AuthValues } from '@/features/onboarding/AuthForm';
import { CloudNotConfigured } from '@/features/onboarding/CloudNotConfigured';
import { authService } from '@/services/authService';
import { useAppStore } from '@/store/useAppStore';

export default function SignUp() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  const submit = async (v: AuthValues) => {
    setLoading(true);
    setError(null);
    const r = await authService.signUp(v.email, v.password, v.name ?? '');
    setLoading(false);
    if (!r.ok) return setError(r.error ?? 'Unable to create account.');
    if (r.needsConfirmation) return setConfirmEmail(v.email);
    useAppStore.getState().setPreferences({ displayName: v.name ?? '', email: v.email });
    router.replace('/onboarding/markets');
  };

  return (
    <Screen header={<AppHeader title="Create account" back />}>
      <AppText variant="title">Protect every account.</AppText>
      {isDemoMode ? (
        <CloudNotConfigured next={next} />
      ) : confirmEmail ? (
        <Card tone="accent">
          <AppText variant="heading">Check your email</AppText>
          <AppText variant="body" tone="secondary">
            We sent a confirmation link to {confirmEmail}. Confirm it, then sign in.
          </AppText>
        </Card>
      ) : (
        <AuthForm mode="sign-up" loading={loading} error={error} onSubmit={submit} onProvider={async (p) => setError((await authService.signInWithProvider(p)).error ?? null)} />
      )}
    </Screen>
  );
}
