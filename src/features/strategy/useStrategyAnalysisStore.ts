import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  answerQuestion,
  clearResolution,
  makeResolution,
  setResolution,
  setSuggestionStatus,
  type ResolveInput,
  type StrategyRuleItem,
  type StructuredStrategy,
  type SuggestionStatus,
} from '@/lib/engines/strategyIntelligence';
import { answerPlan, decideSuggestion, extractPlan, rebasePlan, type Answer, type StrategyPlan } from '@/lib/engines/strategyPlan';

/**
 * The strategy being analysed. Holds ONLY the trader's submitted text and the
 * analysis of that exact text — no example or template is ever stored here.
 * Persisted so "Finish later" in Resolve Missing Rules keeps the trader's progress.
 */
interface StrategyAnalysisState {
  text: string;
  /** The canonical plan of `text` (fields, branches, answers, suggestion decisions). */
  plan: StrategyPlan | null;
  analysis: StructuredStrategy | null;
  /** Saved strategy this analysis was saved as (so later saves update it). */
  savedId: string | null;
  submit: (text: string) => void;
  setAnalysis: (a: StructuredStrategy | null) => void;
  decide: (suggestionId: string, status: SuggestionStatus, editedText?: string) => void;
  answer: (questionId: string, answer: string) => void;
  /** Record the trader's explicit decision for a rule item. */
  resolve: (item: StrategyRuleItem, input: ResolveInput) => void;
  unresolve: (itemId: string) => void;
  setSavedId: (id: string | null) => void;
  /** Continue resolving a saved strategy. */
  load: (analysis: StructuredStrategy, savedId: string) => void;
  reset: () => void;
  /** Build the plan for the current text when there is none (older saved progress). */
  ensurePlan: () => void;
  /** The trader edited the description of the plan being worked on: same saved strategy, answers kept. */
  revise: (text: string) => void;
  answerPlan: (id: string, answer: Answer) => void;
  decidePlanSuggestion: (id: string, status: 'accepted' | 'rejected' | 'pending') => void;
  /** Reopen a saved plan for editing. */
  loadPlan: (plan: StrategyPlan, savedId: string) => void;
}

export const useStrategyAnalysisStore = create<StrategyAnalysisState>()(
  persist(
    (set) => ({
      text: '',
      plan: null,
      analysis: null,
      savedId: null,
      // A new submission always discards the previous analysis (no cached results across texts).
      submit: (text) => set({ text, analysis: null, savedId: null, plan: extractPlan(text) }),
      setAnalysis: (analysis) => set((s) => (analysis && analysis.originalText !== s.text ? {} : { analysis })),
      decide: (id, status, editedText) => set((s) => (s.analysis ? { analysis: setSuggestionStatus(s.analysis, id, status, editedText) } : {})),
      answer: (id, a) => set((s) => (s.analysis ? { analysis: answerQuestion(s.analysis, id, a) } : {})),
      resolve: (item, input) => set((s) => (s.analysis ? { analysis: setResolution(s.analysis, makeResolution(item, input)) } : {})),
      unresolve: (itemId) => set((s) => (s.analysis ? { analysis: clearResolution(s.analysis, itemId) } : {})),
      setSavedId: (savedId) => set({ savedId }),
      load: (analysis, savedId) => set({ text: analysis.originalText, analysis, savedId }),
      reset: () => set({ text: '', analysis: null, savedId: null, plan: null }),
      ensurePlan: () => set((s) => (s.text.trim() && (!s.plan || s.plan.originalText !== s.text) ? { plan: extractPlan(s.text) } : {})),
      revise: (text) => set((s) => ({ text, analysis: null, plan: s.plan ? rebasePlan(extractPlan(text), s.plan) : extractPlan(text) })),
      answerPlan: (id, a) => set((s) => (s.plan ? { plan: answerPlan(s.plan, id, a) } : {})),
      decidePlanSuggestion: (id, status) => set((s) => (s.plan ? { plan: decideSuggestion(s.plan, id, status) } : {})),
      loadPlan: (plan, savedId) => set({ text: plan.originalText, plan, savedId, analysis: null }),
    }),
    {
      name: 'propguard-strategy-analysis',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // v1 progress has no plan: it is rebuilt from the saved text on open (ensurePlan).
      migrate: (persisted) => ({ plan: null, ...(persisted as object) }) as never,
      partialize: (s) => ({ text: s.text, analysis: s.analysis, savedId: s.savedId, plan: s.plan }),
    },
  ),
);
