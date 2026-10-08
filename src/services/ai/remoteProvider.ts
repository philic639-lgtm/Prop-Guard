import type { z } from 'zod';

import { getTemplate } from '@/data/strategyLibrary';
import { supabase } from '@/services/supabase/client';

import { analyzeStrategyText } from '@/lib/engines/strategyIntelligence/analyze';
import type { UniquenessReference } from '@/lib/engines/strategyIntelligence/uniqueness';

import { MockAIProvider } from './mockProvider';
import { mergeAiStrategyAnalysis } from './strategyAnalysis';
import { matchStrategies } from './strategyMatcher';
import type { AIProvider } from './provider';
import {
  AccountExtractionSchema,
  AccountReadingSchema,
  DailyCoachSchema,
  ParsedStrategySchema,
  PracticeFeedbackSchema,
  ScreenshotExtractionSchema,
  SessionReviewSchema,
  SetupAnalysisSchema,
  StrategyAnalysisAISchema,
  StrategyReasonsSchema,
  type DailyCoachInput,
  type PracticeInput,
  type ScreenshotInput,
  type SessionReviewInput,
  type SetupAnalysisInput,
  type StrategyFinderAnswers,
} from './types';

type Task = 'setup' | 'screenshot' | 'session_review' | 'strategy_finder' | 'daily_coach' | 'strategy_parse' | 'strategy_analyze' | 'account_screenshot' | 'account_screenshot_v2' | 'practice';

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
    const { demo: _demo, ...payload } = input;
    const r = await this.call('screenshot', payload, ScreenshotExtractionSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.analyzeScreenshot(input);
  }

  async generateSessionReview(input: SessionReviewInput) {
    const r = await this.call('session_review', input, SessionReviewSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.generateSessionReview(input);
  }

  async recommendStrategies(answers: StrategyFinderAnswers) {
    // Ranking is always deterministic over the curated library; the model may
    // only rephrase the "why it fits" reasons for those exact templates.
    const ranked = matchStrategies(answers);
    const candidates = ranked.map((m) => {
      const t = getTemplate(m.templateId)!;
      return { id: t.id, name: t.name, category: t.category, style: t.style, sessions: t.sessions, reasons: m.reasons };
    });
    const r = await this.call('strategy_finder', { answers, candidates }, StrategyReasonsSchema);
    if (!r) return ranked;
    const banned = /(profit|guarantee|win rate|proven|returns?\b)/i;
    return ranked.map((m) => {
      const ai = r.explanations.find((e) => e.templateId === m.templateId);
      const reasons = ai?.reasons.filter((x) => !banned.test(x));
      return reasons && reasons.length ? { ...m, reasons } : m;
    });
  }

  async generateDailyCoach(input: DailyCoachInput) {
    const local = await this.fallback.generateDailyCoach(input);
    // Hard safety rail: when the guard says STOP the message is never model-generated.
    if (input.guardStatus === 'STOP') return local;
    const r = await this.call('daily_coach', input, DailyCoachSchema);
    return r ? { ...r, source: 'ai' as const } : local;
  }

  async parseStrategyDescription(text: string) {
    const r = await this.call('strategy_parse', { text: text.slice(0, 2000) }, ParsedStrategySchema);
    if (!r) return this.fallback.parseStrategyDescription(text);
    return { ...r, unparsed: [], source: 'ai' as const };
  }

  async analyzeStrategy(text: string, opts: { references?: UniquenessReference[] } = {}) {
    // Local analysis always runs: it scores the result and is the fallback.
    // Only the trader's own text is sent — no example, template or account data.
    const local = analyzeStrategyText(text, { references: opts.references });
    const r = await this.call('strategy_analyze', { text: text.slice(0, 4000) }, StrategyAnalysisAISchema);
    return r ? mergeAiStrategyAnalysis(r, local, opts.references) : local;
  }

  async analyzeAccountScreenshot(input: ScreenshotInput) {
    const { demo: _demo, ...payload } = input;
    const r = await this.call('account_screenshot', payload, AccountExtractionSchema);
    return r ? { ...r, source: 'ai' as const } : this.fallback.analyzeAccountScreenshot(input);
  }

  async readAccountScreenshot(input: ScreenshotInput) {
    const { demo: _demo, ...payload } = input;
    return this.call('account_screenshot_v2', payload, AccountReadingSchema);
  }

  async practiceFeedback(input: PracticeInput) {
    const r = await this.call('practice', input, PracticeFeedbackSchema);
    return r ? { feedback: r.feedback, source: 'ai' as const } : this.fallback.practiceFeedback(input);
  }
}
