import { create } from 'zustand';

import { answerQuestion, setSuggestionStatus, type StructuredStrategy, type SuggestionStatus } from '@/lib/engines/strategyIntelligence';

/**
 * The strategy being analysed. Holds ONLY the trader's submitted text and the
 * analysis of that exact text — no example or template is ever stored here.
 */
interface StrategyAnalysisState {
  text: string;
  analysis: StructuredStrategy | null;
  submit: (text: string) => void;
  setAnalysis: (a: StructuredStrategy | null) => void;
  decide: (suggestionId: string, status: SuggestionStatus, editedText?: string) => void;
  answer: (questionId: string, answer: string) => void;
  reset: () => void;
}

export const useStrategyAnalysisStore = create<StrategyAnalysisState>((set) => ({
  text: '',
  analysis: null,
  // A new submission always discards the previous analysis (no cached results across texts).
  submit: (text) => set({ text, analysis: null }),
  setAnalysis: (analysis) => set((s) => (analysis && analysis.originalText !== s.text ? {} : { analysis })),
  decide: (id, status, editedText) => set((s) => (s.analysis ? { analysis: setSuggestionStatus(s.analysis, id, status, editedText) } : {})),
  answer: (id, a) => set((s) => (s.analysis ? { analysis: answerQuestion(s.analysis, id, a) } : {})),
  reset: () => set({ text: '', analysis: null }),
}));
