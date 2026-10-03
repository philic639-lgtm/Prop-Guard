import { setCustomInstruments } from '@/lib/engines/instrumentEngine';
import { useAppStore } from '@/store/useAppStore';
import { syncService } from '@/services/syncService';

import { useOnboardingStore } from './useOnboardingStore';

/** Commit onboarding answers as the user's real data (replacing demo data). Returns the chosen path. */
export function finishOnboarding(): 'have_strategy' | 'build' | null {
  const o = useOnboardingStore.getState();
  const app = useAppStore.getState();
  const mode = app.user ? 'cloud' : 'local';
  const keepName = app.mode === 'demo' ? '' : app.preferences.displayName;
  app.startFresh(mode);
  const s = useAppStore.getState();
  if (o.account) {
    s.upsertAccount(o.account);
    s.setActiveAccount(o.account.id);
  }
  s.setTradingRules(o.rules);
  const instruments = o.markets;
  s.setPreferences({
    displayName: keepName,
    markets: o.markets,
    customInstruments: o.customInstruments,
    tradingType: o.tradingType,
    propFirm: o.propFirm,
    defaultInstrument: instruments[0] ?? 'MES',
    tradingProfile: o.profile,
    onboarded: true,
  });
  if (syncService.enabled) syncService.savePreferences(useAppStore.getState());
  const path = o.profile.path;
  // Draft custom instruments are now saved in preferences.
  setCustomInstruments([], 'draft');
  o.reset();
  return path;
}
