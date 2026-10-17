import { FIRM_RULES_SEED } from '@/data/propFirms/seed';

import type { FirmRulesProvider } from './FirmRulesProvider';

/** The database bundled with the app (works offline and in demo mode). */
export class SeedFirmRulesProvider implements FirmRulesProvider {
  readonly id = 'seed';
  async load() {
    return FIRM_RULES_SEED;
  }
}
