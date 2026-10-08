import { create } from 'zustand';

import type { ConfirmedImport } from '@/lib/engines/accountImport';

/**
 * A confirmed screenshot import waiting to be saved with a NEW account
 * (Accounts → New, or onboarding). Kept in memory only; the account form
 * prefills from it and `applyImport` runs when the account is saved.
 */
export interface PendingImport {
  for: 'new' | 'onboarding';
  confirmed: ConfirmedImport;
  /** Matched program (verified rules load from it), if any. */
  programId: string | null;
  options: Record<string, string>;
  firmName: string | null;
  size: number | null;
  startDate: string | null;
  /** Rule values the trader chose to save (only when no verified program matched). */
  rules: ConfirmedImport['ruleUpdates'];
  /** The form has been prefilled from it. */
  applied?: boolean;
}

interface State {
  pending: PendingImport | null;
  set: (p: PendingImport) => void;
  markApplied: () => void;
  clear: () => void;
}

export const usePendingImport = create<State>((set) => ({
  pending: null,
  set: (pending) => set({ pending: { ...pending, applied: false } }),
  markApplied: () => set((s) => (s.pending ? { pending: { ...s.pending, applied: true } } : s)),
  clear: () => set({ pending: null }),
}));
