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
          repo
            ?.loadAll()
            .then((remote) => {
              const hasRemote = (remote.accounts?.length ?? 0) > 0 || remote.preferences?.onboarded;
              if (hasRemote) {
                store.replaceData({ ...remote, mode: 'cloud' } as never);
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
