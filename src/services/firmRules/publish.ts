import type { SupabaseClient } from '@supabase/supabase-js';

import type { FirmRulesDatabase } from '@/data/propFirms/types';
import { parseFirmRulesDatabase } from '@/lib/engines/firmRulesEngine';

import { dbToRows } from './rows';

/**
 * SERVER-ONLY. Publishes a firm rules database to Supabase with the
 * service-role client (`npm run firm-rules:publish`, or a scheduled backend
 * job that re-verifies official firm sources). Never import in screens.
 *
 * The feed is validated first; a version claiming `verified` without
 * sources, reviewer and date is downgraded and reported, never published as
 * verified. Rule versions are append-only by (program, rule_version).
 */
export interface PublishReport {
  firms: number;
  programs: number;
  versions: number;
  downgraded: string[];
}

export async function publishFirmRules(input: unknown, client: SupabaseClient | null): Promise<PublishReport> {
  const parsed = parseFirmRulesDatabase(input);
  if (!parsed.db) throw new Error(`Invalid firm rules database:\n- ${parsed.errors.join('\n- ')}`);
  const db: FirmRulesDatabase = parsed.db;
  const rows = dbToRows(db);
  if (client) {
    const up = async (table: string, data: object[], onConflict: string) => {
      if (!data.length) return;
      const { error } = await client.from(table).upsert(data, { onConflict });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    };
    await up('prop_firms', rows.firms, 'id');
    await up('prop_firm_programs', rows.programs, 'id');
    await up('prop_firm_rule_versions', rows.versions, 'program_id,rule_version');
  }
  return { firms: rows.firms.length, programs: rows.programs.length, versions: rows.versions.length, downgraded: parsed.downgraded };
}
