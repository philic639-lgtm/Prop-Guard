import { create } from 'zustand';

import type { Strategy } from '@/types/domain';

/** Unsaved strategy being reviewed after AI conversion or generation. */
interface StrategyDraftState {
  draft: Strategy | null;
  origin: 'describe' | 'build' | 'template' | null;
  source: 'ai' | 'local' | null;
  setDraft: (draft: Strategy | null, origin?: StrategyDraftState['origin'], source?: StrategyDraftState['source']) => void;
  patch: (patch: Partial<Strategy>) => void;
}

export const useStrategyDraftStore = create<StrategyDraftState>((set) => ({
  draft: null,
  origin: null,
  source: null,
  setDraft: (draft, origin = null, source = null) => set({ draft, origin, source }),
  patch: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
}));
