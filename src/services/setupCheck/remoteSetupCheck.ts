import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnalysisMode, ClientSetupInput, IccSummary, SetupEvaluation } from '@/lib/engines/setupCheck';

import { isErrorCode, SetupCheckError } from './errors';

export interface RemoteSetupResult {
  analysisId: number | null;
  analysisMode: AnalysisMode;
  visionError: string | null;
  key: string;
  strategyVersion: string;
  evaluatedAt: string;
  rules: { id: string; label: string; description: string; kind: 'visual' | 'system' | 'icc'; required: boolean; critical: boolean }[];
  evaluation: SetupEvaluation;
  /** ICC strategies: the ICC SETUP card, computed on the server. */
  icc?: IccSummary | null;
}

export interface RemoteSetupClient {
  analyze(payload: { input: ClientSetupInput; image: { base64: string; mimeType: string }; imageHash: string }): Promise<RemoteSetupResult>;
  evaluate(payload: { input: ClientSetupInput; imageHash: string | null; analysisId: number | null }): Promise<RemoteSetupResult>;
}

const DECISIONS = new Set(['TAKE TRADE', 'WAIT', 'STAND DOWN']);
const TIMEOUT_MS = 60_000;

function validate(data: unknown): RemoteSetupResult {
  const d = data as Partial<RemoteSetupResult> | null;
  if (!d || typeof d !== 'object' || !d.evaluation || !DECISIONS.has(d.evaluation.decision) || !Array.isArray(d.rules) || !['REAL', 'UNAVAILABLE'].includes(String(d.analysisMode))) {
    throw new SetupCheckError('malformed');
  }
  return d as RemoteSetupResult;
}

/**
 * Calls the authenticated `setup-validation` Edge Function. The server loads
 * the strategy, account and risk settings itself and computes the decision;
 * the OpenAI key exists only in the function's secrets.
 */
export function remoteSetupClient(supabase: SupabaseClient): RemoteSetupClient {
  const call = async (body: Record<string, unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SetupCheckError('timeout')), TIMEOUT_MS);
      });
      const { data, error } = await Promise.race([supabase.functions.invoke('setup-validation', { body }), timeout]);
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const parsed = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
        throw new SetupCheckError(isErrorCode(parsed?.code) ? parsed.code : /fetch|network/i.test(error.message) ? 'network' : 'unavailable');
      }
      return validate(data);
    } catch (e) {
      if (e instanceof SetupCheckError) throw e;
      throw new SetupCheckError('network');
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    analyze: (p) => call({ action: 'analyze', input: p.input, image: p.image, imageHash: p.imageHash }),
    evaluate: (p) => call({ action: 'evaluate', input: p.input, imageHash: p.imageHash, analysisId: p.analysisId }),
  };
}
