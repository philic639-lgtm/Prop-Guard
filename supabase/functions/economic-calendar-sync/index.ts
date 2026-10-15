// Supabase Edge Function (Deno) — scheduled economic-calendar refresh.
// Deploy:   npm run shared:sync && supabase functions deploy economic-calendar-sync --no-verify-jwt
// Secrets:  supabase secrets set ECON_SYNC_SECRET=<random string>
//           [ECON_CONTACT=<your e-mail or URL, sent in the User-Agent>]
//           [ECON_BEA_TIMES_EASTERN=true]  (only after confirming BEA's page lists Eastern times)
//           [ECON_FOMC_VERIFIED_TIMES={"2026-12-16":"14:00"}]
//           [ECON_BLS_URL] [ECON_BEA_URL] [ECON_FED_URL] [ECON_BLS_UPDATES_URL] [ECON_FED_UPDATES_URL]
//           (the official defaults are built in — set these only to override)
// Schedule: every 6 hours via pg_cron + pg_net (docs/ECONOMIC_CALENDAR_DEPLOY.md).
//
// Reads ONLY official sources — BLS iCalendar, BEA release-schedule page, FOMC calendar,
// and the BLS / Fed monetary-policy RSS feeds — with conditional requests and no AI.
// A failed or unrecognised feed changes nothing but its status row: events are never
// invented or dropped because a source was down. No released numbers are stored.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { eventToRow, rowToEvent, rowToStatus, statusToRow, updateToRow } from '../_shared/economicCalendar/rows.ts';
import { readSource, readUpdateFeed, sourceConfigFromEnv } from '../_shared/economicCalendar/sources.ts';
import { planSourceSync, planUpdateSync } from '../_shared/economicCalendar/sync.ts';
import type { EconSource, UpdateFeed } from '../_shared/economicCalendar/types.ts';

const SECRET = Deno.env.get('ECON_SYNC_SECRET') ?? '';
const SOURCES: EconSource[] = ['bls', 'bea', 'fed'];
const UPDATE_FEEDS: UpdateFeed[] = ['bls_updates', 'fed_updates'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!SECRET || req.headers.get('x-sync-secret') !== SECRET) return new Response('unauthorized', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const cfg = sourceConfigFromEnv((k) => Deno.env.get(k));
  const now = new Date();
  const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  const summary: Record<string, unknown> = {};

  for (const source of SOURCES) {
    const [{ data: statusRow }, { data: storedRows }] = await Promise.all([
      db.from('economic_feed_status').select('*').eq('source', source).maybeSingle(),
      db.from('economic_events').select('*').eq('source', source).gte('date_et', todayET),
    ]);
    const prev = statusRow ? rowToStatus(statusRow) : null;
    const validators = { etag: (statusRow?.etag as string | null) ?? null, lastModified: (statusRow?.last_modified as string | null) ?? null };
    const result = await readSource(source, cfg, fetch, validators, now);
    const plan = planSourceSync((storedRows ?? []).map(rowToEvent), result, prev, now);

    let writeError: string | null = null;
    if (plan.upserts.length) {
      const { error } = await db.from('economic_events').upsert(plan.upserts.map(eventToRow), { onConflict: 'id' });
      if (error) writeError = error.message;
    }
    if (!writeError && plan.deactivate.length) {
      const { error } = await db.from('economic_events').update({ active: false }).in('id', plan.deactivate);
      if (error) writeError = error.message;
    }
    // A database error must not look like a successful refresh.
    const status = writeError ? { ...plan.status, status: 'error' as const, error: 'database write failed', lastSuccessAt: prev?.lastSuccessAt ?? null } : plan.status;
    await db.from('economic_feed_status').upsert(statusToRow(status, writeError ? validators : result.validators), { onConflict: 'source' });
    summary[source] = { status: status.status, events: plan.upserts.length, deactivated: plan.deactivate.length, error: status.error };
  }
  for (const feed of UPDATE_FEEDS) {
    const { data: statusRow } = await db.from('economic_feed_status').select('*').eq('source', feed).maybeSingle();
    const prev = statusRow ? rowToStatus(statusRow) : null;
    const validators = { etag: (statusRow?.etag as string | null) ?? null, lastModified: (statusRow?.last_modified as string | null) ?? null };
    const result = await readUpdateFeed(feed, cfg, fetch, validators, now);
    const plan = planUpdateSync(result, prev, now);
    let writeError: string | null = null;
    if (plan.upserts.length) {
      const { error } = await db.from('economic_updates').upsert(plan.upserts.map(updateToRow), { onConflict: 'id' });
      if (error) writeError = error.message;
    }
    const status = writeError ? { ...plan.status, status: 'error' as const, error: 'database write failed', lastSuccessAt: prev?.lastSuccessAt ?? null } : plan.status;
    await db.from('economic_feed_status').upsert(statusToRow(status, writeError ? validators : result.validators), { onConflict: 'source' });
    summary[feed] = { status: status.status, items: plan.upserts.length, error: status.error };
  }
  // Counts and statuses only.
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
