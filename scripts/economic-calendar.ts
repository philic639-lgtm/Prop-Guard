/**
 * Economic calendar CLI (server-side, Node).
 *
 *   npm run econ:check   — read + parse every configured source and print what was found
 *                          (counts, coverage, a few upcoming releases). Writes nothing.
 *                          Run this first against the live feeds to confirm each format.
 *   npm run econ:sync    — the same refresh the Edge Function does, written to Supabase with
 *                          SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.server.
 *
 * Config (env / .env.server): ECON_CONTACT, ECON_BEA_URL, ECON_BEA_TIMES_EASTERN,
 * ECON_FOMC_VERIFIED_TIMES, ECON_BLS_URL, ECON_FED_URL.
 */
import { createClient } from '@supabase/supabase-js';

import { eventToRow, rowToEvent, rowToStatus, statusToRow } from '../src/lib/engines/economicCalendar/rows';
import { readSource, sourceConfigFromEnv, type FetchLike } from '../src/lib/engines/economicCalendar/sources';
import { planSourceSync } from '../src/lib/engines/economicCalendar/sync';
import { DEFAULT_NEWS_RULES, isRelevant } from '../src/lib/engines/economicCalendar/rules';
import type { EconSource } from '../src/lib/engines/economicCalendar/types';

const SOURCES: EconSource[] = ['bls', 'bea', 'fed'];
const cfg = sourceConfigFromEnv((k) => process.env[k]);
const mode = process.argv[2];

async function check() {
  const now = new Date();
  let failures = 0;
  for (const source of SOURCES) {
    const r = await readSource(source, cfg, fetch as unknown as FetchLike, { etag: null, lastModified: null }, now);
    if (!r.ok) {
      failures++;
      console.log(`✗ ${source}: ${r.error}`);
      continue;
    }
    const ev = r.events ?? [];
    const future = ev.filter((e) => e.dateET >= now.toISOString().slice(0, 10));
    const timed = ev.filter((e) => e.timeStatus !== 'unknown').length;
    const codes = [...new Set(ev.map((e) => e.code))].join(', ');
    console.log(`✓ ${source}: ${ev.length} releases (${timed} with a time), coverage ${ev[0]?.dateET ?? '—'} → ${ev[ev.length - 1]?.dateET ?? '—'}; families: ${codes}`);
    for (const e of future.filter((x) => isRelevant(x, { ...DEFAULT_NEWS_RULES, minImpact: 'medium' })).slice(0, 6))
      console.log(`    ${e.dateET} ${e.timeET ?? '--:--'} ET (${e.timeStatus})  ${e.name}  ← "${e.title}"`);
  }
  process.exitCode = failures ? 1 : 0;
}

async function sync() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.server) — or use econ:check for a dry run.');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  for (const source of SOURCES) {
    const [{ data: statusRow }, { data: stored }] = await Promise.all([
      db.from('economic_feed_status').select('*').eq('source', source).maybeSingle(),
      db.from('economic_events').select('*').eq('source', source).gte('date_et', todayET),
    ]);
    const validators = { etag: (statusRow?.etag as string | null) ?? null, lastModified: (statusRow?.last_modified as string | null) ?? null };
    const result = await readSource(source, cfg, fetch as unknown as FetchLike, validators, now);
    const plan = planSourceSync((stored ?? []).map(rowToEvent), result, statusRow ? rowToStatus(statusRow) : null, now);
    if (plan.upserts.length) {
      const { error } = await db.from('economic_events').upsert(plan.upserts.map(eventToRow), { onConflict: 'id' });
      if (error) throw new Error(`${source}: ${error.message}`);
    }
    if (plan.deactivate.length) {
      const { error } = await db.from('economic_events').update({ active: false }).in('id', plan.deactivate);
      if (error) throw new Error(`${source}: ${error.message}`);
    }
    await db.from('economic_feed_status').upsert(statusToRow(plan.status, result.validators), { onConflict: 'source' });
    console.log(`${source}: ${plan.status.status}${plan.status.error ? ` (${plan.status.error})` : ''} — ${plan.upserts.length} upserted, ${plan.deactivate.length} deactivated`);
  }
}

(mode === 'sync' ? sync() : check()).catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
