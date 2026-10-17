import { isDemoMode } from '@/config/env';

import { supabase } from './supabase/client';

/**
 * Authentication facade. Email/password is implemented; Apple and Google are
 * structured as providers so they can be enabled without touching screens.
 */
export type AuthProvider = 'email' | 'apple' | 'google';

export interface AuthResult {
  ok: boolean;
  userId?: string;
  email?: string;
  needsConfirmation?: boolean;
  error?: string;
}

export const AUTH_PROVIDERS: { id: AuthProvider; label: string; available: boolean }[] = [
  { id: 'email', label: 'Email', available: true },
  // Enable with expo-apple-authentication + supabase.auth.signInWithIdToken({ provider: 'apple' })
  { id: 'apple', label: 'Continue with Apple', available: false },
  // Enable with @react-native-google-signin/google-signin + signInWithIdToken({ provider: 'google' })
  { id: 'google', label: 'Continue with Google', available: false },
];

const notConfigured: AuthResult = {
  ok: false,
  error: 'Cloud sync is not configured. Add Supabase keys to .env to enable accounts. You can keep using Prop Guard on this device.',
};

export const authService = {
  async signIn(email: string, password: string): Promise<AuthResult> {
    if (isDemoMode || !supabase) return notConfigured;
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return { ok: false, error: error?.message ?? 'Unable to sign in.' };
    return { ok: true, userId: data.user.id, email: data.user.email ?? email };
  },

  async signUp(email: string, password: string, displayName: string): Promise<AuthResult> {
    if (isDemoMode || !supabase) return notConfigured;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) return { ok: true, needsConfirmation: true, email };
    return { ok: true, userId: data.user?.id, email: data.user?.email ?? email };
  },

  async resetPassword(email: string): Promise<AuthResult> {
    if (isDemoMode || !supabase) return notConfigured;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return error ? { ok: false, error: error.message } : { ok: true };
  },

  async signInWithProvider(provider: Exclude<AuthProvider, 'email'>): Promise<AuthResult> {
    return { ok: false, error: `${provider === 'apple' ? 'Apple' : 'Google'} sign-in is coming soon.` };
  },

  async signOut() {
    if (supabase) await supabase.auth.signOut();
  },

  async currentUser() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  },
};
