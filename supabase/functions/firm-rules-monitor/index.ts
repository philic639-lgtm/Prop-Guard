// Supabase Edge Function (Deno) — scheduled prop-firm rules monitor.
// Deploy:  npm run shared:sync && supabase functions deploy firm-rules-monitor --no-verify-jwt
// Secret:  supabase secrets set FIRM_RULES_MONITOR_SECRET=<random string>
// Schedule: weekly via pg_cron + pg_net (see migration 20261017000000).
//
// Low cost by design: runs on a schedule (never on user visits), checks at
// most 25 DUE sources per run with conditional requests, hashes normalised
// page text (no AI), and only FLAGS changes for human review. It never edits
// or publishes rule values; verified data stays as it is when a source is
// blocked or down.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { applyCheck, DEFAULT_MAX_PER_RUN, dueSources, newSource, sourcesFromDatabase, type MonitoredSource } from '../_shared/firmRules/monitor.ts';

const SECRET = Deno.env.get('FIRM_RULES_MONITOR_SECRET') ?? '';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;
const UA = 'PropGuardRulesMonitor/1.0 (weekly check of published rule pages)';

type Row = Record<string, unknown>;
const toSource = (r: Row): MonitoredSource => ({
  url: String(r.url),
  title: (r.title as string | null) ?? null,
  firmId: String(r.firm_id),
  programIds: Array.isArray(r.program_ids) ? r.program_ids.map(String) : [],
  contentHash: (r.content_hash as string | null) ?? null,
  etag: (r.etag as string | null) ?? null,
  lastModified: (r.last_modified as string | null) ?? null,
  lastCheckedAt: (r.last_checked_at as string | null) ?? null,
  nextCheckAt: (r.next_check_at as string | null) ?? null,
  consecutiveFailures: Number(r.consecutive_failures ?? 0),
  lastStatus: (r.last_status as MonitoredSource['lastStatus']) ?? 'new',
});
const toRow = (s: MonitoredSource) => ({
  url: s.url,
  title: s.title,
  firm_id: s.firmId,
  program_ids: s.programIds,
  content_hash: s.contentHash,
  etag: s.etag,
  last_modified: s.lastModified,
  last_checked_at: s.lastCheckedAt,
  next_check_at: s.nextCheckAt,
  consecutive_failures: s.consecutiveFailures,
  last_status: s.lastStatus,
});

async function fetchPage(s: MonitoredSource) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'text/html' };
    if (s.etag) headers['If-None-Match'] = s.etag;
    if (s.lastModified) headers['If-Modified-Since'] = s.lastModified;
    const res = await fetch(s.url, { headers, signal: controller.signal, redirect: 'follow' });
    const body = res.status >= 200 && res.status < 300 ? (await res.text()).slice(0, MAX_BYTES) : undefined;
    return { status: res.status, body, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!SECRET || req.headers.get('x-monitor-secret') !== SECRET) return new Response('unauthorized', { status: 401 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // 1. Register sources cited by the published rules (new ones only — existing state is kept).
  const [{ data: programs }, { data: versions }, { data: existing }] = await Promise.all([
    db.from('prop_firm_programs').select('id,firm_id,options'),
    db.from('prop_firm_rule_versions').select('program_id,sources,records'),
    db.from('prop_firm_sources').select('*'),
  ]);
  const byProgram = new Map<string, Row[]>();
  for (const v of versions ?? []) byProgram.set(String(v.program_id), [...(byProgram.get(String(v.program_id)) ?? []), v]);
  const cited = sourcesFromDatabase({
    programs: (programs ?? []).map((p: Row) => ({
      id: String(p.id),
      firmId: String(p.firm_id),
      options: Array.isArray(p.options) ? (p.options as { sources: { url: string; title?: string }[] }[]) : [],
      versions: (byProgram.get(String(p.id)) ?? []).map((v) => ({ verification: { sources: (v.sources as { url: string; title?: string }[]) ?? [] }, records: (v.records as { sources: { url: string; title?: string }[] }[]) ?? [] })),
    })),
  });
  const known = new Map((existing ?? []).map((r: Row) => [String(r.url), toSource(r)]));
  const fresh = cited.filter((c) => !known.has(c.url)).map(newSource);
  if (fresh.length) await db.from('prop_firm_sources').upsert(fresh.map(toRow), { onConflict: 'url', ignoreDuplicates: true });

  // 2. Check only what is due (capped per run).
  const now = new Date();
  const all = [...known.values(), ...fresh];
  const due = dueSources(all, now, DEFAULT_MAX_PER_RUN);
  const summary = { checked: 0, unchanged: 0, changed: 0, new: 0, failed: 0, reviews: 0 };
  for (const s of due) {
    const res = await fetchPage(s);
    const r = applyCheck(s, res, now);
    summary.checked++;
    if (r.status === 'unchanged') summary.unchanged++;
    else if (r.status === 'changed') summary.changed++;
    else if (r.status === 'new') summary.new++;
    else summary.failed++;
    await db.from('prop_firm_sources').upsert(toRow(r.source), { onConflict: 'url' });
    await db.from('prop_firm_source_checks').insert({ url: s.url, http_status: res.status, status: r.status, content_hash: r.source.contentHash, reason: r.reason });
    if (r.reviewNeeded) {
      const { error } = await db.from('prop_firm_rule_reviews').insert({ url: s.url, firm_id: s.firmId, program_ids: s.programIds, previous_hash: s.contentHash, new_hash: r.source.contentHash, reason: r.reason });
      if (!error) summary.reviews++; // a pending review for this source already exists otherwise
    }
  }
  // Never log page contents — counts only.
  return new Response(JSON.stringify({ ...summary, registered: fresh.length, due: due.length }), { headers: { 'Content-Type': 'application/json' } });
});
