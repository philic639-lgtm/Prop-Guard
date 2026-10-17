import { create } from 'zustand';

import { DEFAULT_PREFERENCES, DEFAULT_TRADING_RULES } from '@/data/demo';
import type { InstrumentSpec } from '@/data/instruments';
import type { Account, InstrumentSymbol, TradingProfile, TradingRules, TradingType } from '@/types/domain';

/** Transient onboarding answers. Committed to the app store on the final step. */
interface OnboardingState {
  markets: InstrumentSymbol[];
  customInstruments: InstrumentSpec[];
  tradingType: TradingType;
  propFirm: string;
  account: Account | null;
  rules: TradingRules;
  profile: TradingProfile;
  set: (patch: Partial<Omit<OnboardingState, 'set' | 'reset'>>) => void;
  setProfile: (patch: Partial<TradingProfile>) => void;
  reset: () => void;
}

const initial = {
  markets: ['ES', 'MES'] as InstrumentSymbol[],
  customInstruments: [] as InstrumentSpec[],
  tradingType: 'prop' as TradingType,
  propFirm: '',
  account: null,
  rules: DEFAULT_TRADING_RULES,
  profile: DEFAULT_PREFERENCES.tradingProfile,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
  reset: () => set(initial),
}));
