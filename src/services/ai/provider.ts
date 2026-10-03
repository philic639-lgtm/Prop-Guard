import type { SessionReview } from '@/types/domain';

import type {
  DailyCoach,
  DailyCoachInput,
  ScreenshotExtraction,
  ScreenshotInput,
  SessionReviewInput,
  SetupAnalysis,
  SetupAnalysisInput,
  StrategyFinderAnswers,
  StrategyRecommendation,
} from './types';

/**
 * Provider-independent AI interface. Implementations: MockAIProvider (on
 * device, deterministic) and RemoteAIProvider (Supabase Edge Function that
 * talks to OpenAI / Anthropic / any provider server-side).
 */
export interface AIProvider {
  readonly name: string;
  analyzeTradeSetup(input: SetupAnalysisInput): Promise<SetupAnalysis>;
  analyzeScreenshot(input: ScreenshotInput): Promise<ScreenshotExtraction>;
  generateSessionReview(input: SessionReviewInput): Promise<Omit<SessionReview, 'generatedAt'>>;
  recommendStrategies(answers: StrategyFinderAnswers): Promise<StrategyRecommendation[]>;
  generateDailyCoach(input: DailyCoachInput): Promise<DailyCoach>;
}
