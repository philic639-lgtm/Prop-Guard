import type { SupabaseClient } from '@supabase/supabase-js';

import { parseFirmRulesDatabase } from '@/lib/engines/firmRulesEngine';

import type { FirmRulesProvider } from './FirmRulesProvider';
import { rowsToDb } from './rows';

/**
 * Reads the published firm rules with the PUBLIC (anon) client. Row-level
 * security only exposes active firms/programs and verified rule versions;
 * writes are server-only (`publish.ts`, service role).
 */
export class SupabaseFirmRulesProvider implements FirmRulesProvider {
  readonly id = 'supabase';
  constructor(private readonly client: SupabaseClient) {}

  async load() {
    const [firms, programs, versions] = await Promise.all([
      this.client.from('prop_firms').select('id,name,aliases,logo_url,website,active,updated_at'),
      this.client.from('prop_firm_programs').select('id,firm_id,name,family,stage,account_size,active,sort_order').order('sort_order'),
      this.client.from('prop_firm_rule_versions').select('program_id,rule_version,effective_date,last_verified_at,verification_status,verified_by,sources,notes,rules,created_at'),
    ]);
    const err = firms.error ?? programs.error ?? versions.error;
    if (err) throw new Error(`Firm rules could not be loaded: ${err.message}`);
    const stamps = [...(firms.data ?? []).map((f) => String(f.updated_at ?? '')), ...(versions.data ?? []).map((v) => String(v.created_at ?? ''))].filter(Boolean).sort();
    const parsed = parseFirmRulesDatabase(rowsToDb(firms.data ?? [], programs.data ?? [], versions.data ?? [], stamps[stamps.length - 1] ?? new Date(0).toISOString()));
    if (!parsed.db) throw new Error(`Firm rules feed rejected: ${parsed.errors.slice(0, 3).join('; ')}`);
    return parsed.db;
  }
}
