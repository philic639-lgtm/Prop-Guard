import type { SupabaseClient } from '@supabase/supabase-js';

import type { VisionRequest } from '@/lib/engines/setupValidation';

import { SetupCheckError, type SetupCheckErrorCode } from './errors';
import type { VisionAnalysisProvider, VisionImage, VisionResponse } from './VisionAnalysisProvider';

const CLIENT_TIMEOUT_MS = 60_000;
const CODES = new Set<SetupCheckErrorCode>(['image_invalid', 'no_rules', 'rate_limited', 'timeout', 'unavailable', 'malformed', 'unauthorized']);

/**
 * Calls the `setup-validation` Supabase Edge Function. The OpenAI key lives
 * only in the function's server-side secrets — never in this bundle.
 */
export class RemoteVisionProvider implements VisionAnalysisProvider {
  readonly id = 'remote' as const;
  constructor(private readonly client: SupabaseClient) {}

  async analyze(image: VisionImage, request: VisionRequest): Promise<VisionResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SetupCheckError('timeout')), CLIENT_TIMEOUT_MS);
    });
    try {
      const call = this.client.functions.invoke('setup-validation', { body: { image, request } });
      const { data, error } = await Promise.race([call, timeout]);
      if (error) {
        // FunctionsHttpError carries the response; read our error code from it.
        const ctx = (error as { context?: Response }).context;
        let code: SetupCheckErrorCode = 'unavailable';
        if (ctx && typeof ctx.json === 'function') {
          const body = await ctx.json().catch(() => null);
          if (body?.code && CODES.has(body.code)) code = body.code;
        } else if (/fetch|network/i.test(error.message)) code = 'network';
        throw new SetupCheckError(code, error.message);
      }
      if (!data || typeof data !== 'object' || !('result' in data)) throw new SetupCheckError('malformed');
      return { raw: (data as { result: unknown }).result, model: typeof (data as { model?: unknown }).model === 'string' ? (data as { model: string }).model : null, provider: 'ai' };
    } catch (e) {
      if (e instanceof SetupCheckError) throw e;
      throw new SetupCheckError('network', (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }
}
