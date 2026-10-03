import { create } from 'zustand';

import { DEFAULT_TRADING_RULES } from '@/data/demo';
import type { Account, InstrumentSymbol, TradingRules, TradingType } from '@/types/domain';

/** Transient onboarding answers. Committed to the app store on the final step. */
interface OnboardingState {
  markets: (InstrumentSymbol | 'OTHER')[];
  tradingType: TradingType;
  propFirm: string;
  account: Account | null;
  rules: TradingRules;
  set: (patch: Partial<Omit<OnboardingState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

const initial = {
  markets: ['ES', 'MES'] as (InstrumentSymbol | 'OTHER')[],
  tradingType: 'prop' as TradingType,
  propFirm: '',
  account: null,
  rules: DEFAULT_TRADING_RULES,
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set(initial),
}));
