import type { SupabaseClient } from '@supabase/supabase-js';

import type { ErrorCode, TradeReading } from '@/lib/engines/tradeScreenshot';

import { supabase as defaultClient } from './supabase/client';

/**
 * Journal screenshot reading through the authenticated `trade-screenshot`
 * Edge Function (OpenAI key stays in the function's secrets). Every failure
 * becomes a plain message and the journal falls back to manual entry —
 * nothing is ever filled in without a real reading.
 */
export type TradeShotResult =
  | { status: 'ok'; reading: TradeReading }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; code: ErrorCode | 'unauthorized' | 'network' | 'invalid_response'; message: string };

const MESSAGES: Record<string, string> = {
  bad_request: 'The screenshot could not be sent. Try again.',
  image_too_large: 'That image is too large. Use a normal screenshot (under 8 MB).',
  image_invalid: 'That file is not a readable PNG, JPG or WebP screenshot.',
  rate_limited: 'Too many screenshots in a short time. Wait a little, or enter the trade manually.',
  provider_error: 'The screenshot reader is unavailable right now. Enter the trade manually.',
  provider_timeout: 'Reading took too long. Try again, or enter the trade manually.',
  not_configured: 'Automatic reading is not set up on the server yet. Enter the trade manually.',
  unauthorized: 'Your session expired. Sign in again to read screenshots.',
  network: 'No connection to the server. Check your internet, or enter the trade manually.',
  invalid_response: 'The reader returned something unexpected. Enter the trade manually.',
};
export const messageFor = (code: string) => MESSAGES[code] ?? MESSAGES.provider_error;

const TIMEOUT_MS = 60_000;

/** Minimal shape check of the server's reply (the server already normalized it). */
function isReading(x: unknown): x is TradeReading {
  const r = x as TradeReading;
  return !!r && typeof r === 'object' && typeof r.kind === 'string' && !!r.entryPrice && Array.isArray(r.warnings) && typeof r.usable === 'boolean';
}

export async function readTradeScreenshot(image: { base64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }, client: SupabaseClient | null = defaultClient): Promise<TradeShotResult> {
  if (!client) return { status: 'unavailable', message: 'Automatic reading needs the Prop Guard server, which is not configured in this build. Enter the trade manually.' };
  const { data: session } = await client.auth.getSession();
  if (!session.session) return { status: 'unavailable', message: 'Sign in to read screenshots automatically. You can still enter the trade manually.' };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([client.functions.invoke('trade-screenshot', { body: { image } }), timeout]);
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const status = ctx && typeof ctx.status === 'number' ? ctx.status : 0;
      const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      const code = typeof parsed?.error === 'string' && parsed.error in MESSAGES ? parsed.error : status === 401 ? 'unauthorized' : /fetch|network|failed to send/i.test(error.message) ? 'network' : 'provider_error';
      return { status: 'error', code, message: messageFor(code) };
    }
    const reading = (data as { reading?: unknown } | null)?.reading;
    if (!isReading(reading)) return { status: 'error', code: 'invalid_response', message: messageFor('invalid_response') };
    return { status: 'ok', reading };
  } catch (e) {
    const code = (e as Error).message === 'timeout' ? 'provider_timeout' : 'network';
    return { status: 'error', code, message: messageFor(code) };
  } finally {
    clearTimeout(timer);
  }
}
