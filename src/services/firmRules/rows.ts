import { FIRM_RULES_SCHEMA_VERSION, type FirmRulesDatabase, type ProgramRuleVersion } from '@/data/propFirms/types';

/**
 * Row mapping for the `prop_firms`, `prop_firm_programs` and
 * `prop_firm_rule_versions` tables — shared by the app (read) and the
 * server publisher (write) so both agree on one shape.
 */
type Row = Record<string, unknown>;

export function dbToRows(db: FirmRulesDatabase) {
  return {
    firms: db.firms.map((f) => ({ id: f.id, name: f.name, aliases: f.aliases, logo_url: f.logo, website: f.website, active: f.active })),
    programs: db.programs.map((p, i) => ({ id: p.id, firm_id: p.firmId, name: p.name, family: p.family, stage: p.stage, account_size: p.accountSize, active: p.active, sort_order: i, line: p.line ?? null, options: p.options ?? [] })),
    versions: db.programs.flatMap((p) =>
      p.versions.map((v) => ({
        program_id: p.id,
        rule_version: v.ruleVersion,
        effective_date: v.effectiveDate.slice(0, 10),
        last_verified_at: v.lastVerifiedAt,
        verification_status: v.verification.status,
        verified_by: v.verification.verifiedBy,
        sources: v.verification.sources,
        notes: v.verification.notes ?? null,
        rules: v.rules,
        records: v.records ?? [],
      })),
    ),
  };
}

/** Assemble rows into a database (still to be validated with `parseFirmRulesDatabase`). */
export function rowsToDb(firms: Row[], programs: Row[], versions: Row[], publishedAt: string): unknown {
  const byProgram = new Map<string, ProgramRuleVersion[]>();
  for (const v of versions) {
    const list = byProgram.get(String(v.program_id)) ?? [];
    list.push({
      ruleVersion: String(v.rule_version),
      effectiveDate: String(v.effective_date),
      lastVerifiedAt: (v.last_verified_at as string | null) ?? null,
      verification: {
        status: v.verification_status === 'verified' ? 'verified' : 'unverified',
        sources: Array.isArray(v.sources) ? (v.sources as ProgramRuleVersion['verification']['sources']) : [],
        verifiedBy: (v.verified_by as string | null) ?? null,
        ...(v.notes ? { notes: String(v.notes) } : {}),
      },
      rules: v.rules as ProgramRuleVersion['rules'],
      ...(Array.isArray(v.records) && v.records.length ? { records: v.records as NonNullable<ProgramRuleVersion['records']> } : {}),
    });
    byProgram.set(String(v.program_id), list);
  }
  return {
    schemaVersion: FIRM_RULES_SCHEMA_VERSION,
    publishedAt,
    source: 'remote',
    firms: firms.map((f) => ({ id: String(f.id), name: String(f.name), aliases: Array.isArray(f.aliases) ? f.aliases.map(String) : [], logo: (f.logo_url as string | null) ?? null, website: (f.website as string | null) ?? null, active: f.active !== false })),
    programs: programs.map((p) => ({
      id: String(p.id),
      firmId: String(p.firm_id),
      name: String(p.name),
      family: String(p.family),
      stage: p.stage,
      accountSize: p.account_size == null ? null : Number(p.account_size),
      active: p.active !== false,
      ...(p.line ? { line: String(p.line) } : {}),
      ...(Array.isArray(p.options) && p.options.length ? { options: p.options } : {}),
      versions: byProgram.get(String(p.id)) ?? [],
    })),
  };
}
