/**
 * Runtime configuration. Only EXPO_PUBLIC_* variables are bundled into the
 * client — never put secrets (service role keys, AI provider keys,
 * RevenueCat secret keys) in EXPO_PUBLIC_* variables.
 */
export type SupabaseEnv = { url: string; key: string; configured: boolean; problem: string | null };

/** The JWT `role` claim, when the key is a JWT (legacy anon / service_role keys). */
function jwtRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part || typeof atob !== 'function') return null;
  try {
    return (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks the two public Supabase build variables. Says WHICH one is missing (never its value) and
 * refuses a secret / service-role key: those bypass row-level security and must never ship in an app.
 */
export function readSupabaseEnv(rawUrl: string | undefined, rawKey: string | undefined): SupabaseEnv {
  const url = (rawUrl ?? '').trim().replace(/\/+$/, '');
  const key = (rawKey ?? '').trim();
  const missing = [!url.startsWith('http') && 'EXPO_PUBLIC_SUPABASE_URL', key.length <= 20 && 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].filter(Boolean) as string[];
  const secret = key.startsWith('sb_secret_') || jwtRole(key) === 'service_role';
  const problem = secret
    ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY holds a secret (service-role) key. It is not used — replace it with the publishable (anon) key and rotate the secret key.'
    : missing.length
      ? `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set in this build. Add ${missing.length > 1 ? 'them' : 'it'} to the hosting environment and rebuild — EXPO_PUBLIC_ values are fixed when the app is built.`
      : null;
  return { url, key: secret ? '' : key, configured: !problem, problem };
}

const supabase = readSupabaseEnv(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const aiMode = process.env.EXPO_PUBLIC_AI_MODE?.trim() ?? '';
const revenueCatIosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() ?? '';
const revenueCatAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() ?? '';
const devUnlockPro = process.env.EXPO_PUBLIC_DEV_UNLOCK_PRO?.trim() ?? '';

export const env = {
  supabaseUrl: supabase.url,
  supabaseAnonKey: supabase.key,
  /** True when Supabase credentials are present. Otherwise the app runs in Demo Mode. */
  supabaseConfigured: supabase.configured,
  /** Why Supabase is not configured (variable names only, never values); null when it is. */
  supabaseProblem: supabase.problem,
  /**
   * 'remote' routes AI calls through the Supabase Edge Function `ai-gateway`
   * (keys stay server-side). Anything else uses the on-device mock provider.
   */
  aiMode: aiMode === 'remote' ? ('remote' as const) : ('mock' as const),
  revenueCatIosKey,
  revenueCatAndroidKey,
  /** Unlock Pro features while developing. Defaults to ON when billing is not configured. */
  devUnlockPro: devUnlockPro ? devUnlockPro === 'true' : !(revenueCatIosKey || revenueCatAndroidKey),
} as const;

export const isDemoMode = !env.supabaseConfigured;
