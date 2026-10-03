import type { z } from 'zod';

import { STRATEGY_LIBRARY } from '@/data/strategyLibrary';
import { supabase } from '@/services/supabase/client';

import { MockAIProvider } from './mockProvider';
import type { AIProvider } from './provider';
import {
  DailyCoachSchema,
  ScreenshotExtractionSchema,
  SessionReviewSchema,
  SetupAnalysisSchema,
  StrategyRecommendationSchema,
  type DailyCoachInput,
  type ScreenshotInput,
  type SessionReviewInput,
  type SetupAnalysisInput,
  type StrategyFinderAnswers,
} from './types';

type Task = 'setup' | 'screenshot' | 'session_review' | 'strategy_finder' | 'daily_coach';

/**
 * Calls the `ai-gateway` Supabase Edge Function. Provider API keys live ONLY
 * in the function's server-side secrets. Every response is schema-validated;
 * on any failure we fall back to the local provider so the app never breaks.
 */
export class RemoteAIProvider implements AIProvider {
  readonly name = 'Prop Guard AI';
  private readonly fallback = new MockAIProvider();

  private async call<S extends z.ZodTypeAny>(task: Task, input: unknown, schema: S): Promise<z.infer<S> | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.functions.invoke('ai-gateway', { body: { task, input } });
      if (error) throw error;
      const parsed = schema.safeParse(data?.result);
      if (!parsed.success) {
        console.warn(`[ai] ${task} response failed validation`, parsed.error.issues.slice(0, 3));
        return null;
      }
      return parsed.data;
    } catch (e) {
      console.warn(`[ai] ${task} failed`, (e as Error).message);
      return null;
    }
  }

  async analyzeTradeSetup(input: SetupAnalysisInput) {
    const r = await this.call('setup', input, SetupAnalysisSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.analyzeTradeSetup(input);
  }

  async analyzeScreenshot(input: ScreenshotInput) {
    const r = await this.call('screenshot', input, ScreenshotExtractionSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.analyzeScreenshot(input);
  }

  async generateSessionReview(input: SessionReviewInput) {
    const r = await this.call('session_review', input, SessionReviewSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.generateSessionReview(input);
  }

  async recommendStrategies(answers: StrategyFinderAnswers) {
    const library = STRATEGY_LIBRARY.map((t) => ({
      id: t.id,
      name: t.name,
      style: t.style,
      timing: t.timing,
      tradesPerDay: t.tradesPerDay,
      stopRange: t.stopRange,
      minRR: t.defaults.minRR,
      complexity: t.complexity,
    }));
    const r = await this.call('strategy_finder', { answers, library }, StrategyRecommendationSchema);
    const valid = r?.recommendations.filter((rec) => STRATEGY_LIBRARY.some((t) => t.id === rec.templateId));
    return valid && valid.length > 0 ? valid : this.fallback.recommendStrategies(answers);
  }

  async generateDailyCoach(input: DailyCoachInput) {
    const local = await this.fallback.generateDailyCoach(input);
    // Hard safety rail: when the guard says STOP the message is never model-generated.
    if (input.guardStatus === 'STOP') return local;
    const r = await this.call('daily_coach', input, DailyCoachSchema);
    return r ? { ...r, source: 'ai' as const } : local;
  }
}
