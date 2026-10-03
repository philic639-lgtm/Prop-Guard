import { useAppStore } from '@/store/useAppStore';
import { syncService } from '@/services/syncService';
import type { InstrumentSymbol } from '@/types/domain';

import { useOnboardingStore } from './useOnboardingStore';

/** Commit onboarding answers as the user's real data (replacing demo data). */
export function finishOnboarding() {
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
  const instruments = o.markets.filter((m): m is InstrumentSymbol => m !== 'OTHER');
  s.setPreferences({
    displayName: keepName,
    markets: o.markets,
    tradingType: o.tradingType,
    propFirm: o.propFirm,
    defaultInstrument: instruments.includes('MES') ? 'MES' : (instruments[0] ?? 'MES'),
    onboarded: true,
  });
  if (syncService.enabled) syncService.savePreferences(useAppStore.getState());
  o.reset();
}
