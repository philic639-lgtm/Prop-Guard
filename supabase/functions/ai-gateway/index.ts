// Supabase Edge Function (Deno). Deploy: supabase functions deploy ai-gateway
// Secrets: supabase secrets set AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... (or OPENAI_API_KEY)
//
// The client sends a { task, input } payload of MINIMIZED data. This function
// authenticates the caller, builds a task-specific prompt, asks the model for
// strict JSON, and returns { result }. The client validates the result again.

import { createClient } from 'npm:@supabase/supabase-js@2';

type Task = 'setup' | 'screenshot' | 'session_review' | 'strategy_finder' | 'daily_coach' | 'strategy_parse' | 'account_screenshot' | 'practice';

const PROVIDER = (Deno.env.get('AI_PROVIDER') ?? 'anthropic').toLowerCase();
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';

const SYSTEM = `You are Prop Guard, a disciplined trading risk manager.
You NEVER predict market direction, never say a trade will win, and never encourage breaking the trader's rules,
increasing size, revenge trading, or overtrading. You evaluate whether the trader is following THEIR OWN plan.
Discipline and capital protection always come first. Respond ONLY with JSON matching the requested schema.`;

const TASK_PROMPTS: Record<Task, string> = {
  setup: `Explain the deterministic setup evaluation provided. Do not change the grade.
Return JSON: {"headline": string, "summary": string (<=600 chars), "cautions": string[] (<=6), "reminders": string[] (<=4)}`,
  screenshot: `Extract trade details visible in this chart screenshot. Use null for anything not clearly visible. Never guess.
Return JSON: {"instrument": "ES"|"MES"|"NQ"|"MNQ"|null, "direction": "long"|"short"|null, "entry": number|null, "stop": number|null,
"target": number|null, "levels": [{"label": string, "price": number}], "detected": {"orb": boolean, "vwap": boolean, "supportResistance": boolean},
"confidence": "low"|"medium"|"high", "notes": string}`,
  session_review: `Review this trading session for PROCESS quality (rule adherence), not profit.
Return JSON: {"summary": string, "strengths": string[], "improvements": string[], "focusTomorrow": string}`,
  strategy_finder: `The candidates were already ranked deterministically from Prop Guard's curated library. For each candidate id, rewrite
up to 5 short reasons explaining why its STRUCTURE fits the trader's answers. Do not add, remove or reorder strategies.
Never mention profitability, win rates, returns, backtests or guarantees.
Return JSON: {"explanations": [{"templateId": string, "reasons": string[]}]}`,
  daily_coach: `Write a short coaching note that prioritizes discipline over generating trades.
Return JSON: {"message": string (<=400 chars), "bestAction": string (<=160 chars)}`,
  strategy_parse: `Convert the trader's plain-English strategy into MEASURABLE rules. Do not add rules they did not state.
Times are US/Eastern 24h "HH:mm". Return JSON: {"name": string, "instrument": "ES"|"MES"|"NQ"|"MNQ"|null,
"entryWindowStart": string|null, "entryWindowEnd": string|null, "biasRequirement": string, "requiresBiasAlignment": boolean,
"stopMaxPoints": number|null, "minRR": number|null, "maxTrades": number|null, "conditions": string[] (yes/no checklist items, <=12)}`,
  account_screenshot: `Read this prop-firm account dashboard screenshot. Use null for anything not clearly visible. Never guess.
Return JSON: {"balance": number|null, "dailyPnl": number|null, "totalPnl": number|null, "drawdownRemaining": number|null,
"accountType": string|null, "confidence": "low"|"medium"|"high", "notes": string}`,
  practice: `Give specific feedback on this practice attempt: name exactly which conditions are missing and whether the plan says ENTER, WAIT or NO TRADE.
Return JSON: {"feedback": string (<=400 chars)}`,
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
}

async function callAnthropic(task: Task, input: Record<string, unknown>) {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const content: unknown[] = [];
  if (task === 'screenshot' || task === 'account_screenshot') {
    content.push({ type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.imageBase64 } });
    content.push({ type: 'text', text: TASK_PROMPTS[task] });
  } else {
    content.push({ type: 'text', text: `${TASK_PROMPTS[task]}\n\nINPUT:\n${JSON.stringify(input)}` });
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const text = (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  return extractJson(text);
}

async function callOpenAI(task: Task, input: Record<string, unknown>) {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const userContent =
    task === 'screenshot' || task === 'account_screenshot'
      ? [
          { type: 'text', text: TASK_PROMPTS[task] },
          { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` } },
        ]
      : `${TASK_PROMPTS[task]}\n\nINPUT:\n${JSON.stringify(input)}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return extractJson(data.choices?.[0]?.message?.content ?? '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Authenticate the caller with their own JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) return json({ error: 'Unauthorized' }, 401);

  let body: { task?: Task; input?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  const task = body.task;
  if (!task || !(task in TASK_PROMPTS) || typeof body.input !== 'object' || body.input === null) {
    return json({ error: 'Invalid task' }, 400);
  }
  if ((task === 'screenshot' || task === 'account_screenshot') && String(body.input.imageBase64 ?? '').length > 6_000_000) {
    return json({ error: 'Image too large' }, 413);
  }

  try {
    const result = PROVIDER === 'openai' ? await callOpenAI(task, body.input) : await callAnthropic(task, body.input);
    // Audit trail (input is already minimized by the client; screenshots are not stored here).
    const summary = task === 'screenshot' || task === 'account_screenshot' ? { mimeType: body.input.mimeType } : body.input;
    await supabase.from('ai_analysis').insert({
      user_id: userData.user.id,
      kind: task,
      input_summary: summary,
      output: result,
      provider: PROVIDER,
      model: PROVIDER === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL,
    });
    return json({ result });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
