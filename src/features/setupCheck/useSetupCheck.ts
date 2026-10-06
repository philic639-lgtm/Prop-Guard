import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { env } from '@/config/env';
import { demoObservations } from '@/services/setupCheck/demoVision';
import { localTrustedContext } from '@/services/setupCheck/localContext';
import { remoteSetupClient } from '@/services/setupCheck/remoteSetupCheck';
import { strategyRecordOf } from '@/services/setupCheck/strategyRecord';
import { supabase } from '@/services/supabase/client';
import { useAppStore } from '@/store/useAppStore';

import { SetupCheckController, type ControllerDeps, type ProviderMode, type SetupForm } from './controller';

/**
 * - demo mode → DEMO (simulated chart reading, never clears a setup)
 * - signed in with AI configured → REMOTE (server checks the setup)
 * - otherwise → MANUAL (no chart analysis; the trader confirms each rule)
 */
export function useProviderMode(): ProviderMode {
  const storeMode = useAppStore((s) => s.mode);
  if (storeMode === 'demo') return 'DEMO';
  if (env.aiMode === 'remote' && supabase && storeMode === 'cloud') return 'REMOTE';
  return 'MANUAL';
}

export function useSetupCheck(initial: SetupForm) {
  const mode = useProviderMode();
  const strategies = useAppStore((s) => s.strategies);
  const accounts = useAppStore((s) => s.accounts);
  const trades = useAppStore((s) => s.trades);
  const tradingRules = useAppStore((s) => s.tradingRules);

  const deps = useMemo<ControllerDeps>(() => {
    const records = new Map(strategies.map((s) => [s.id, strategyRecordOf(s)]));
    return {
      mode,
      strategy: (id) => (id ? (records.get(id) ?? null) : null),
      trusted: (form, record, now) => localTrustedContext({ record, instrument: form.instrument, account: accounts.find((a) => a.id === form.accountId) ?? null, trades, tradingRules, now }),
      demoVision: demoObservations,
      remote: mode === 'REMOTE' && supabase ? remoteSetupClient(supabase) : null,
      now: () => new Date(),
    };
  }, [mode, strategies, accounts, trades, tradingRules]);

  const [controller] = useState(() => new SetupCheckController(deps, initial));
  useEffect(() => controller.setDeps(deps), [controller, deps]);

  // State and view come from one snapshot so the React Compiler can't memoize a stale view.
  const { state, view } = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  // REMOTE: re-evaluate on the server after edits (debounced); stale responses are discarded by the controller.
  useEffect(() => {
    if (mode !== 'REMOTE' || !view.pending) return;
    const t = setTimeout(() => void controller.refresh(), 400);
    return () => clearTimeout(t);
  }, [mode, view.pending, state, controller]);

  return { controller, state, view, mode };
}
