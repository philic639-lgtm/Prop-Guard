import type { SessionReview } from '@/types/domain';

import type { StructuredStrategy } from '@/lib/engines/strategyIntelligence/types';
import type { UniquenessReference } from '@/lib/engines/strategyIntelligence/uniqueness';
import type { ParsedStrategy } from '@/lib/engines/strategyParser';

import type {
  AccountExtraction,
  DailyCoach,
  PracticeInput,
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
  /** Convert a plain-English strategy into measurable rules. */
  parseStrategyDescription(text: string): Promise<ParsedStrategy & { source: 'ai' | 'local' }>;
  /**
   * Strategy Intelligence: interpret, diagnose, find behavioral risks and
   * suggest measurable improvements for ANY free-text strategy. Analyses only
   * the given text — never a template or example.
   */
  analyzeStrategy(text: string, opts?: { references?: UniquenessReference[] }): Promise<StructuredStrategy>;
  /** Read balance / P&L / drawdown from a prop-firm dashboard screenshot. */
  analyzeAccountScreenshot(input: ScreenshotInput): Promise<AccountExtraction>;
  /** Short, specific feedback for a practice attempt. */
  practiceFeedback(input: PracticeInput): Promise<{ feedback: string; source: 'ai' | 'local' }>;
}
