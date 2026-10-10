// Supabase Edge Function (Deno) — trade screenshot extraction for the journal.
// Deploy:  npm run shared:sync && supabase functions deploy trade-screenshot
// Secrets: supabase secrets set OPENAI_API_KEY=sk-... OPENAI_VISION_MODEL=<vision-capable model id>
//          [TRADE_SCREENSHOT_RATE_PER_MINUTE=6] [TRADE_SCREENSHOT_RATE_PER_HOUR=30]
//          [TRADE_SCREENSHOT_RATE_PER_DAY=100] [TRADE_SCREENSHOT_TIMEOUT_MS=30000] [OPENAI_BASE_URL]
//
// Flow: authenticated user → image validated (type, signature, size) →
// per-user limits (service-role request log the user cannot edit) → OpenAI
// Responses API with a strict JSON schema → deterministic checks
// (../_shared/tradeScreenshot) → reading returned for the trader to confirm.
// The image is held in memory only for this request: never stored, never
// logged. Errors are fixed codes — never provider text or image content.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleTradeScreenshot, MAX_IMAGE_BYTES } from '../_shared/tradeScreenshot/handler.ts';
import { INSTRUMENT_CATALOG } from '../_shared/setupCheck/instruments.ts';

const KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const MODEL = Deno.env.get('OPENAI_VISION_MODEL') ?? '';
/** Override only for a proxy / gateway; defaults to OpenAI. */
const BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/$/, '');
const TIMEOUT_MS = Number(Deno.env.get('TRADE_SCREENSHOT_TIMEOUT_MS') ?? '30000');
const LIMITS = {
  perMinute: Number(Deno.env.get('TRADE_SCREENSHOT_RATE_PER_MINUTE') ?? '6'),
  perHour: Number(Deno.env.get('TRADE_SCREENSHOT_RATE_PER_HOUR') ?? '30'),
  perDay: Number(Deno.env.get('TRADE_SCREENSHOT_RATE_PER_DAY') ?? '100'),
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** OpenAI Responses API with strict structured output. Returns the parsed JSON object. */
async function callOpenAI({ developer, user, image, schema }: { developer: string; user: string; image: { base64: string; mime: string }; schema: { name: string; schema: unknown } }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        max_output_tokens: 3000,
        input: [
          { role: 'developer', content: [{ type: 'input_text', text: developer }] },
          { role: 'user', content: [{ type: 'input_text', text: user }, { type: 'input_image', image_url: `data:${image.mime};base64,${image.base64}`, detail: 'high' }] },
        ],
        text: { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.schema } },
      }),
    });
    if (!res.ok) throw new Error(`provider_${res.status}`);
    const body = await res.json();
    if (body.status && body.status !== 'completed') throw new Error(`provider_${body.status}`);
    const text: string =
      typeof body.output_text === 'string'
        ? body.output_text
        : (body.output ?? [])
            .flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? [])
            .filter((c: { type: string }) => c.type === 'output_text')
            .map((c: { text?: string }) => c.text ?? '')
            .join('');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'bad_request' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: authError } = await db.auth.getUser();
  if (authError || !userData.user) return json({ error: 'unauthorized' }, 401);
  const userId = userData.user.id;

  if (Number(req.headers.get('content-length') ?? '0') > MAX_IMAGE_BYTES * 1.4 + 16_000) return json({ error: 'image_too_large' }, 413);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // Request log written with the service role: users can read but not alter their counts.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const result = await handleTradeScreenshot(body, {
    configured: !!KEY && !!MODEL,
    catalog: INSTRUMENT_CATALOG,
    limits: LIMITS,
    recentRequests: async (ms) =>
      (await admin.from('setup_validation_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'trade_screenshot').gte('created_at', new Date(Date.now() - ms).toISOString())).count ?? 0,
    begin: async () => {
      const { data } = await admin.from('setup_validation_requests').insert({ user_id: userId, kind: 'trade_screenshot', model: MODEL, status: 'started' }).select('id').single();
      return async (status) => {
        if (data?.id != null) await admin.from('setup_validation_requests').update({ status }).eq('id', data.id);
      };
    },
    callModel: callOpenAI,
  });
  if (result.status !== 200) console.warn(`[trade-screenshot] ${result.body.error}`); // code only — no content
  return json(result.body, result.status);
});
