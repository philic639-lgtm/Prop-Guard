import { supabase } from '@/services/supabase/client';

import type { FirmRulesProvider } from './FirmRulesProvider';
import { SupabaseFirmRulesProvider } from './SupabaseFirmRulesProvider';

export type { FirmRulesProvider } from './FirmRulesProvider';
export { SeedFirmRulesProvider } from './SeedFirmRulesProvider';
export { SupabaseFirmRulesProvider } from './SupabaseFirmRulesProvider';

/** Remote sources merged over the bundled seed (none in demo mode). */
export function remoteFirmRulesProvider(): FirmRulesProvider | null {
  return supabase ? new SupabaseFirmRulesProvider(supabase) : null;
}
