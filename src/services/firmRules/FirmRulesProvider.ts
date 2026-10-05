import type { FirmRulesDatabase } from '@/data/propFirms/types';

/**
 * Source of the prop-firm rules database. The app merges every provider's
 * result over the bundled seed, so rules can be updated centrally (a backend
 * job publishing verified versions) without a frontend release.
 */
export interface FirmRulesProvider {
  readonly id: string;
  /** Validated database, or null when the source is unavailable (offline, demo mode). */
  load(): Promise<FirmRulesDatabase | null>;
}
