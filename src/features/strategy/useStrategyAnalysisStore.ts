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

/**
 * The strategy being analysed. Holds ONLY the trader's submitted text and the
 * analysis of that exact text — no example or template is ever stored here.
 * Persisted so "Finish later" in Resolve Missing Rules keeps the trader's progress.
 */
interface StrategyAnalysisState {
  text: string;
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
}

export const useStrategyAnalysisStore = create<StrategyAnalysisState>()(
  persist(
    (set) => ({
      text: '',
      analysis: null,
      savedId: null,
      // A new submission always discards the previous analysis (no cached results across texts).
      submit: (text) => set({ text, analysis: null, savedId: null }),
      setAnalysis: (analysis) => set((s) => (analysis && analysis.originalText !== s.text ? {} : { analysis })),
      decide: (id, status, editedText) => set((s) => (s.analysis ? { analysis: setSuggestionStatus(s.analysis, id, status, editedText) } : {})),
      answer: (id, a) => set((s) => (s.analysis ? { analysis: answerQuestion(s.analysis, id, a) } : {})),
      resolve: (item, input) => set((s) => (s.analysis ? { analysis: setResolution(s.analysis, makeResolution(item, input)) } : {})),
      unresolve: (itemId) => set((s) => (s.analysis ? { analysis: clearResolution(s.analysis, itemId) } : {})),
      setSavedId: (savedId) => set({ savedId }),
      load: (analysis, savedId) => set({ text: analysis.originalText, analysis, savedId }),
      reset: () => set({ text: '', analysis: null, savedId: null }),
    }),
    {
      name: 'propguard-strategy-analysis',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ text: s.text, analysis: s.analysis, savedId: s.savedId }),
    },
  ),
);
