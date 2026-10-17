/**
 * Runtime configuration. Only EXPO_PUBLIC_* variables are bundled into the
 * client — never put secrets (service role keys, AI provider keys,
 * RevenueCat secret keys) in EXPO_PUBLIC_* variables.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const aiMode = process.env.EXPO_PUBLIC_AI_MODE?.trim() ?? '';
const revenueCatIosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() ?? '';
const revenueCatAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() ?? '';
const devUnlockPro = process.env.EXPO_PUBLIC_DEV_UNLOCK_PRO?.trim() ?? '';

export const env = {
  supabaseUrl,
  supabaseAnonKey,
  /** True when Supabase credentials are present. Otherwise the app runs in Demo Mode. */
  supabaseConfigured: supabaseUrl.startsWith('http') && supabaseAnonKey.length > 20,
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
