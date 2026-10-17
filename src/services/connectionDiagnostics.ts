import { Platform } from 'react-native';

/**
 * Why a browser refused a request, when it says so. A page whose Content Security Policy does
 * not allow a host (e.g. a sandboxed preview frame) makes `fetch` fail with a bare
 * "Failed to fetch"; the browser reports the real reason only as a `securitypolicyviolation`
 * event. Recording those lets the app show the actual cause instead of a guess.
 */
export interface PolicyBlock {
  /** Origin the page tried to reach (no path, no query — never credentials). */
  blockedOrigin: string;
  /** The CSP directive that blocked it, e.g. "connect-src". */
  directive: string;
  at: string;
}

const blocks = new Map<string, PolicyBlock>();
let installed = false;

function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin;
  } catch {
    return null;
  }
}

/** Start listening (web only; idempotent). */
export function watchPolicyBlocks(): void {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('securitypolicyviolation', (e) => {
    const origin = originOf(e.blockedURI);
    if (origin) blocks.set(origin, { blockedOrigin: origin, directive: e.effectiveDirective || e.violatedDirective, at: new Date().toISOString() });
  });
}

/** The latest recorded block for this host since `since` (ISO), if any. */
export function policyBlockFor(url: string, since?: string): PolicyBlock | null {
  const origin = originOf(url);
  const b = origin ? blocks.get(origin) : undefined;
  return b && (!since || b.at >= since) ? b : null;
}

/** Test hook. */
export function recordPolicyBlock(b: PolicyBlock): void {
  blocks.set(b.blockedOrigin, b);
}

/** Shown on screen so a tester can tell which build is running. */
export const DIAGNOSTICS_BUILD = 'calendar-diagnostics-3';

const ms = (t0: number) => `${Math.round(Date.now() - t0)} ms`;
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 160);

/**
 * Step-by-step connection test, run on the viewer's own device (web). Every line is plain
 * evidence: where the page runs, whether fetch is the browser's own, and what each request
 * returned. Credentials never appear — the key is sent but not printed.
 */
export async function runConnectionTest(supabaseUrl: string, apiKey: string): Promise<string[]> {
  watchPolicyBlocks();
  const started = new Date().toISOString();
  const out: string[] = [`Build: ${DIAGNOSTICS_BUILD}`];
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return [...out, 'No browser fetch available here.'];
  let framed = 'unknown';
  try {
    framed = window.top === window.self ? 'no' : 'yes';
  } catch {
    framed = 'yes (cross-origin parent)';
  }
  out.push(`Page: ${location.origin} · in a frame: ${framed} · secure context: ${String(window.isSecureContext)}`);
  out.push(`fetch: ${/\[native code\]/.test(Function.prototype.toString.call(fetch)) ? "the browser's own" : 'replaced by the page host'}`);
  let t0 = Date.now();
  try {
    const r = await fetch(location.href, { method: 'GET', cache: 'no-store' });
    out.push(`1. Same-site request (this page): HTTP ${r.status} in ${ms(t0)}`);
  } catch (e) {
    out.push(`1. Same-site request (this page): failed — ${errText(e)} after ${ms(t0)}`);
  }
  const base = supabaseUrl.replace(/\/$/, '');
  t0 = Date.now();
  try {
    const r = await fetch(`${base}/rest/v1/`, { mode: 'no-cors', cache: 'no-store' });
    out.push(`2. Supabase, opaque request (no CORS): reached — response type "${r.type}" in ${ms(t0)}`);
  } catch (e) {
    out.push(`2. Supabase, opaque request (no CORS): blocked before any response — ${errText(e)} after ${ms(t0)}`);
  }
  t0 = Date.now();
  const target = `${base}/rest/v1/economic_feed_status?select=source,status,last_success_at`;
  try {
    const r = await fetch(target, { headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, cache: 'no-store' });
    const body = (await r.text()).slice(0, 160);
    out.push(`3. Supabase read (GET ${target}): HTTP ${r.status} in ${ms(t0)} · body: ${body}`);
  } catch (e) {
    out.push(`3. Supabase read (GET ${target}): failed — ${errText(e)} after ${ms(t0)}`);
  }
  // Browsers dispatch the violation report shortly after the request fails.
  await new Promise((r) => setTimeout(r, 500));
  const block = policyBlockFor(base, started);
  out.push(block ? `Security policy report: ${block.directive} blocked ${block.blockedOrigin}` : 'Security policy report: none received from the browser');
  return out;
}
