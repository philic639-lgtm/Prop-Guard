import { router } from 'expo-router';
import { useState } from 'react';

import { AppHeader, AppText, Screen } from '@/components/ui';
import { isDemoMode } from '@/config/env';
import { AuthForm, type AuthValues } from '@/features/onboarding/AuthForm';
import { CloudNotConfigured } from '@/features/onboarding/CloudNotConfigured';
import { authService } from '@/services/authService';

export default function SignIn() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (v: AuthValues) => {
    setLoading(true);
    setError(null);
    const r = await authService.signIn(v.email, v.password);
    setLoading(false);
    if (!r.ok) return setError(r.error ?? 'Unable to sign in.');
    // Auth listener hydrates data; route through index to pick home vs onboarding.
    router.dismissAll();
    router.replace('/');
  };

  return (
    <Screen header={<AppHeader title="Sign in" back />}>
      <AppText variant="title">Welcome back.</AppText>
      {isDemoMode ? (
        <CloudNotConfigured />
      ) : (
        <>
          <AuthForm mode="sign-in" loading={loading} error={error} onSubmit={submit} onProvider={async (p) => setError((await authService.signInWithProvider(p)).error ?? null)} />
          <AppText variant="caption" align="center" tone="accent" onPress={() => router.replace('/auth/sign-up')} accessibilityRole="link">
            New here? Create an account
          </AppText>
        </>
      )}
    </Screen>
  );
}
