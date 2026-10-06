import { env, isDemoMode } from '@/config/env';
import { evaluateSetup, parseVisionOutput, strategyCriteria, visionRequestOf, type RiskContext, type SetupCheckUserInput } from '@/lib/engines/setupValidation';
import { supabase } from '@/services/supabase/client';
import type { SetupCheck, Strategy } from '@/types/domain';
import { uuid } from '@/utils/id';

import { SetupCheckError } from './errors';
import { validateImage } from './imageValidation';
import { MockVisionProvider } from './MockVisionProvider';
import { RemoteVisionProvider } from './RemoteVisionProvider';
import type { VisionAnalysisProvider, VisionImage } from './VisionAnalysisProvider';

/** Minimum gap between analyses from this device (the server also rate-limits). */
const MIN_INTERVAL_MS = 5_000;
let lastRunAt = 0;

/**
 * Remote (server-side OpenAI) when configured; otherwise the clearly-labelled
 * mock in development / demo mode. A production build without AI configured
 * gets a "not configured" error — never fake analysis.
 */
export function visionProvider(): VisionAnalysisProvider | null {
  if (env.aiMode === 'remote' && supabase && !isDemoMode) return new RemoteVisionProvider(supabase);
  if (__DEV__ || isDemoMode) return new MockVisionProvider();
  return null;
}

export const setupCheckIsSimulated = () => visionProvider()?.id === 'mock';

export interface AnalyzeSetupArgs {
  strategy: Strategy | null;
  image: (VisionImage & { uri: string | null }) | null;
  input: Omit<SetupCheckUserInput, 'strategyId'>;
  risk: RiskContext;
  accountId: string | null;
  now?: Date;
  provider?: VisionAnalysisProvider | null;
}

/**
 * SetupAnalysisService: validate inputs → build the strategy's criteria →
 * vision interpretation (server) → validate / repair the output → app-side
 * risk, prop and decision logic. Returns an UNSAVED Setup Check.
 */
export async function analyzeSetup(a: AnalyzeSetupArgs): Promise<SetupCheck> {
  if (!a.strategy) throw new SetupCheckError('no_strategy');
  if (!a.image) throw new SetupCheckError('no_screenshot');
  const check = validateImage(a.image);
  if (!check.ok) throw new SetupCheckError(check.reason === 'empty' ? 'no_screenshot' : 'image_invalid', check.reason);
  const input: SetupCheckUserInput = { ...a.input, strategyId: a.strategy.id };
  const criteria = strategyCriteria(a.strategy, { direction: input.direction });
  if (!criteria.some((c) => c.kind === 'visual')) throw new SetupCheckError('no_rules');

  const provider = a.provider === undefined ? visionProvider() : a.provider;
  if (!provider) throw new SetupCheckError('not_configured');
  const now = a.now ?? new Date();
  if (provider.id === 'remote' && now.getTime() - lastRunAt < MIN_INTERVAL_MS) throw new SetupCheckError('rate_limited');
  lastRunAt = now.getTime();

  const response = await provider.analyze({ base64: a.image.base64, mimeType: check.mimeType }, visionRequestOf(a.strategy, input, criteria));
  const parsed = parseVisionOutput(response.raw, criteria);
  if (!parsed.ok) throw new SetupCheckError('malformed', parsed.error);
  return evaluateSetup({ id: uuid(), strategy: a.strategy, input, vision: parsed.output, risk: a.risk, accountId: a.accountId, now, provider: response.provider, model: response.model, screenshotUri: a.image.uri });
}

export { SetupCheckError } from './errors';
export { validateImage, ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from './imageValidation';
