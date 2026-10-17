/**
 * Accuracy check of the DEPLOYED `trade-screenshot` Edge Function against the
 * fixtures in scripts/fixtures/trade-screenshots (real OpenAI calls — costs a
 * few cents). Signs in as a TEST user (never use a real trader's account).
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… TEST_USER_EMAIL=… TEST_USER_PASSWORD=… npm run trade-shot:eval
 *
 * Prints a per-fixture / per-field table and exits non-zero on any miss.
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const DIR = 'scripts/fixtures/trade-screenshots';
const FIELDS = ['kind', 'platform', 'instrument', 'direction', 'entryPrice', 'exitPrice', 'stopPrice', 'targetPrice', 'quantity', 'realizedPnl', 'legible'] as const;

type Fixture = { file: string; expect: Record<string, unknown>; optional?: string[]; mustNotContain?: string[] };

async function main() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!url || !anon || !email || !password) {
    console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD (a test account).');
    process.exit(2);
  }
  const db = createClient(url, anon, { auth: { persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);

  const { fixtures } = JSON.parse(readFileSync(`${DIR}/expected.json`, 'utf8')) as { fixtures: Fixture[] };
  let checks = 0;
  let misses = 0;
  for (const f of fixtures) {
    const base64 = readFileSync(`${DIR}/${f.file}`, 'base64');
    const mimeType = f.file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const t0 = Date.now();
    const { data, error } = await db.functions.invoke('trade-screenshot', { body: { image: { base64, mimeType } } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const body = ctx ? await ctx.json().catch(() => null) : null;
      console.log(`✗ ${f.file}: request failed (${ctx?.status ?? '?'} ${body?.error ?? error.message})`);
      misses++;
      continue;
    }
    const r = data.reading;
    const got: Record<string, unknown> = { kind: r.kind, legible: r.legible };
    for (const k of FIELDS) if (!(k in got)) got[k] = r[k]?.value ?? null;
    const rows: string[] = [];
    for (const [k, want] of Object.entries(f.expect)) {
      checks++;
      const v = got[k];
      const ok = v === want || (typeof v === 'number' && typeof want === 'number' && Math.abs(v - want) < 1e-6) || (f.optional?.includes(k) && v == null);
      if (!ok) misses++;
      rows.push(`${ok ? '✓' : '✗'} ${k}: ${JSON.stringify(v)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
    }
    const text = JSON.stringify(r);
    for (const s of f.mustNotContain ?? []) {
      checks++;
      if (text.includes(s)) {
        misses++;
        rows.push(`✗ reading contains "${s}"`);
      }
    }
    console.log(`\n${f.file}  (${Date.now() - t0} ms, ${r.warnings.length} warnings)\n  ${rows.join('\n  ')}`);
  }
  console.log(`\n${checks - misses}/${checks} checks passed`);
  process.exit(misses ? 1 : 0);
}

void main();
