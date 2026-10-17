import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshEconomicCalendar } from '@/features/intelligence/useEconomicCalendar';
import { useEconomicCalendarStore } from '@/features/intelligence/useEconomicCalendarStore';
import { syncService } from '@/services/syncService';
import { notificationService } from '@/services/notificationService';
import { supabase } from '@/services/supabase/client';
import { useAppStore } from '@/store/useAppStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

/**
 * One-time app bootstrap: notifications, entitlements, and (when Supabase is
 * configured) auth session restore + cloud data hydration.
 */
/** Resolves once the persisted store has been read from device storage. */
function localDataReady(): Promise<void> {
  if (useAppStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useAppStore.persist.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}

export function useBootstrap() {
  useEffect(() => {
    notificationService.configure();
    void useSubscriptionStore.getState().refresh();

    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void syncService.flush();
        // Keep the release calendar (and its phone alerts) current when the trader comes back.
        const fetched = useEconomicCalendarStore.getState().fetchedAt;
        if (!fetched || Date.now() - Date.parse(fetched) > 30 * 60_000) void refreshEconomicCalendar();
      }
    });

    if (!supabase) return () => appStateSub.remove();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const store = useAppStore.getState();
      if (session?.user) {
        const user = { id: session.user.id, email: session.user.email ?? '' };
        const switchedUser = store.user?.id !== user.id;
        // A different signed-in user on this device: drop the previous user's local data first,
        // so it is never shown to, or synced into, the new account.
        if (store.user && switchedUser) store.startFresh('cloud');
        store.setUser(user);
        syncService.attach(user.id);
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          const repo = syncService.repository();
          // Merge only after the device copy is loaded — otherwise the list of saves still
          // waiting for upload is not known yet and older cloud rows could win.
          localDataReady()
            .then(() => repo?.loadAll())
            .then((remote) => {
              if (!remote) return;
              const hasRemote = (remote.accounts?.length ?? 0) > 0 || remote.preferences?.onboarded;
              if (hasRemote) {
                // Merged, not replaced: an account saved on this device whose upload is not
                // confirmed yet stays as saved (and is uploaded again) — older cloud rows never win.
                useAppStore.getState().hydrateFromCloud(remote);
              } else if (switchedUser && store.mode === 'demo') {
                store.startFresh('cloud');
              }
            })
            .catch((e: Error) => console.warn('[bootstrap] load failed', e.message));
        }
      } else if (event === 'SIGNED_OUT') {
        syncService.detach();
        store.signOutLocal();
      }
    });

    return () => {
      appStateSub.remove();
      data.subscription.unsubscribe();
    };
  }, []);
}
