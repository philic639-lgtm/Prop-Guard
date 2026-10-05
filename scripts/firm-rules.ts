/**
 * Prop-firm rules database jobs (SERVER-SIDE ONLY).
 *
 *   npm run firm-rules:export   -- data/firm-rules.json   write the bundled seed as an editable JSON file
 *   npm run firm-rules:validate -- data/firm-rules.json   check a rules file (schema + verification evidence)
 *   npm run firm-rules:publish  -- data/firm-rules.json   publish it to Supabase (dry run without credentials)
 *
 * A future backend job re-verifies official firm sources on a schedule and
 * calls the same `publishFirmRules`. Mark a version `verified` only with the
 * official source URL(s), `verifiedBy` and `lastVerifiedAt`; anything else is
 * downgraded to unverified and is never auto-applied in the app.
 *
 * Environment (never EXPO_PUBLIC_*): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

import { FIRM_RULES_SEED } from '@/data/propFirms/seed';
import { parseFirmRulesDatabase } from '@/lib/engines/firmRulesEngine';
import { publishFirmRules } from '@/services/firmRules/publish';

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (!cmd || !file) throw new Error('Usage: firm-rules <export|validate|publish> <file.json>');

  if (cmd === 'export') {
    writeFileSync(file, JSON.stringify(FIRM_RULES_SEED, null, 2));
    console.log(`Wrote ${FIRM_RULES_SEED.firms.length} firms / ${FIRM_RULES_SEED.programs.length} programs to ${file}`);
    return;
  }

  const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (cmd === 'validate') {
    const r = parseFirmRulesDatabase(input);
    if (!r.db) throw new Error(`Invalid:\n- ${r.errors.join('\n- ')}`);
    const versions = r.db.programs.flatMap((p) => p.versions);
    console.log(`OK: ${r.db.firms.length} firms, ${r.db.programs.length} programs, ${versions.length} rule versions (${versions.filter((v) => v.verification.status === 'verified').length} verified).`);
    if (r.downgraded.length) console.warn(`⚠ Marked verified without evidence (treated as unverified): ${r.downgraded.join(', ')}`);
    return;
  }

  if (cmd === 'publish') {
    const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
    if (!client) console.warn('⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — DRY RUN (validated, nothing published).');
    const report = await publishFirmRules(input, client);
    console.log(`${client ? 'Published' : 'Would publish'}: ${report.firms} firms, ${report.programs} programs, ${report.versions} rule versions.`);
    if (report.downgraded.length) console.warn(`⚠ Published as UNVERIFIED (missing evidence): ${report.downgraded.join(', ')}`);
    return;
  }
  throw new Error(`Unknown command ${cmd}`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
