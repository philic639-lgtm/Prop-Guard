import type { FinderAnswers } from '@/lib/engines/strategyLibraryEngine';
import type { TradingRules, UserPreferences } from '@/types/domain';

/**
 * Finder answers inferred from the trader's saved profile — used for the
 * "For you" section and "Help me build a strategy" without a questionnaire.
 */
export function finderAnswersFromProfile(prefs: UserPreferences, rules: Pick<TradingRules, 'maxTradesPerDay' | 'dailyStop'>): FinderAnswers {
  const p = prefs.tradingProfile;
  return {
    instruments: prefs.markets.length ? prefs.markets : [prefs.defaultInstrument],
    session: p.session === 'ny_open' ? 'ny_open' : p.session === 'morning' ? 'ny_morning' : p.session === 'afternoon' ? 'ny_afternoon' : 'flexible',
    style: 'unsure',
    patience: rules.maxTradesPerDay <= 1 ? 'selective' : rules.maxTradesPerDay <= 2 ? 'quality' : 'frequent',
    holdTime: p.holdTime === 'lt5' ? '1-5' : p.holdTime === '5to30' ? '5-20' : p.holdTime === '30to120' ? '20-60' : p.holdTime === 'hours' ? '60+' : p.style === 'scalp' ? '1-5' : '5-20',
    environment: 'any',
    riskReward: p.riskPreference === 'conservative' ? '1.5' : p.riskPreference === 'aggressive' ? '3' : '2',
    experience: p.experience === 'beginner' ? 'Beginner' : p.experience === 'advanced' ? 'Advanced' : 'Intermediate',
    dailyRisk: rules.dailyStop,
  };
}
