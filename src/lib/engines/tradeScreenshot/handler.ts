// SHARED, dependency-free (synced to supabase/functions/_shared/tradeScreenshot by `npm run shared:sync`).
//
// The `trade-screenshot` Edge Function's request logic, with its side effects
// injected (model call, rate log). The Deno entry point only authenticates
// the user and wires these dependencies; tests run this same code.
//
// Never logged or stored: the image, the model output, account numbers.

import { normalizeTradeReading, type CatalogEntry, type TradeReading } from './normalize';
import { DEVELOPER_PROMPT, TRADE_SCREENSHOT_SCHEMA, USER_PROMPT } from './schema';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_BYTES = 1024;

export interface Limits {
  perMinute: number;
  perHour: number;
  perDay: number;
}
export const DEFAULT_LIMITS: Limits = { perMinute: 6, perHour: 30, perDay: 100 };

export interface HandlerDeps {
  /** Requests by this user in the last `ms` (from the server-side request log). */
  recentRequests: (ms: number) => Promise<number>;
  /** Log a model call BEFORE it is made (it counts toward the limits); returns the outcome recorder. No image or content is logged. */
  begin: () => Promise<(status: 'ok' | 'error', detail: string) => Promise<void>>;
  /** The vision call: returns the parsed structured output, or throws. */
  callModel: (input: { developer: string; user: string; image: { base64: string; mime: ImageMime }; schema: typeof TRADE_SCREENSHOT_SCHEMA }) => Promise<unknown>;
  catalog: readonly CatalogEntry[];
  limits?: Limits;
  /** Present and non-empty when the server is configured (API key + model). */
  configured: boolean;
}

export type HandlerResult = { status: 200; body: { reading: TradeReading } } | { status: 400 | 413 | 415 | 429 | 502 | 503 | 504; body: { error: ErrorCode } };
export type ErrorCode = 'bad_request' | 'image_too_large' | 'image_invalid' | 'rate_limited' | 'provider_error' | 'not_configured' | 'provider_timeout';

export function sniff(bytes: Uint8Array): ImageMime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** Decode and verify: declared type must match the file's signature; size within limits. */
export function decodeImage(raw: unknown): { base64: string; mime: ImageMime } | ErrorCode {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mime = String(o.mimeType ?? '');
  const b64 = typeof o.base64 === 'string' ? o.base64.replace(/^data:[^;]+;base64,/, '') : '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !b64) return 'image_invalid';
  if ((b64.length * 3) / 4 > MAX_IMAGE_BYTES) return 'image_too_large';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return 'image_invalid';
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return 'image_invalid';
  }
  if (bytes.length < MIN_IMAGE_BYTES) return 'image_invalid';
  if (bytes.length > MAX_IMAGE_BYTES) return 'image_too_large';
  if (sniff(bytes) !== mime) return 'image_invalid';
  return { base64: b64, mime: mime as ImageMime };
}

const STATUS: Record<ErrorCode, 400 | 413 | 415 | 429 | 502 | 503 | 504> = {
  bad_request: 400,
  image_too_large: 413,
  image_invalid: 415,
  rate_limited: 429,
  provider_error: 502,
  not_configured: 503,
  provider_timeout: 504,
};
const fail = (error: ErrorCode): HandlerResult => ({ status: STATUS[error], body: { error } }) as HandlerResult;

export async function handleTradeScreenshot(body: unknown, deps: HandlerDeps): Promise<HandlerResult> {
  if (!deps.configured) return fail('not_configured');
  const image = decodeImage(body && typeof body === 'object' ? (body as Record<string, unknown>).image : null);
  if (typeof image === 'string') return fail(image);

  const l = deps.limits ?? DEFAULT_LIMITS;
  if ((await deps.recentRequests(60_000)) >= l.perMinute || (await deps.recentRequests(3_600_000)) >= l.perHour || (await deps.recentRequests(86_400_000)) >= l.perDay) return fail('rate_limited');

  const finish = await deps.begin();
  let raw: unknown;
  try {
    raw = await deps.callModel({ developer: DEVELOPER_PROMPT, user: USER_PROMPT, image, schema: TRADE_SCREENSHOT_SCHEMA });
  } catch (e) {
    const timeout = (e as Error)?.name === 'AbortError' || /timeout/i.test((e as Error)?.message ?? '');
    await finish('error', timeout ? 'timeout' : 'provider');
    return fail(timeout ? 'provider_timeout' : 'provider_error');
  }
  if (!raw || typeof raw !== 'object') {
    await finish('error', 'bad_output');
    return fail('provider_error');
  }
  const reading = normalizeTradeReading(raw, deps.catalog);
  await finish('ok', reading.kind);
  return { status: 200, body: { reading } };
}
