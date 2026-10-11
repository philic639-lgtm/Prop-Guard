import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_ALERT_SETTINGS, type EconAlertSettings } from '@/lib/engines/economicCalendar/alerts';
import type { EconomicEvent, FeedStatus } from '@/lib/engines/economicCalendar';

/**
 * Device cache of the economic calendar (last successful read from the Prop Guard backend)
 * and the trader's alert settings. Kept apart from the trading data: it is public reference
 * data, safe to drop and refetch.
 */
export type CalendarConnection = 'connected' | 'not_configured' | 'error' | 'never';

interface EconState {
  events: EconomicEvent[];
  statuses: FeedStatus[];
  /** When this device last read the calendar from the backend. */
  fetchedAt: string | null;
  connection: CalendarConnection;
  error: string | null;
  loading: boolean;
  alerts: EconAlertSettings;
  /** Min impact for the list / banners ("high" by default; "medium" shows more). */
  showMedium: boolean;
  setCalendar: (p: { events: EconomicEvent[]; statuses: FeedStatus[]; fetchedAt: string }) => void;
  setConnection: (c: CalendarConnection, error?: string | null) => void;
  setLoading: (v: boolean) => void;
  setAlerts: (p: Partial<EconAlertSettings>) => void;
  setShowMedium: (v: boolean) => void;
}

export const useEconomicCalendarStore = create<EconState>()(
  persist(
    (set) => ({
      events: [],
      statuses: [],
      fetchedAt: null,
      connection: 'never',
      error: null,
      loading: false,
      alerts: DEFAULT_ALERT_SETTINGS,
      showMedium: false,
      setCalendar: ({ events, statuses, fetchedAt }) => set({ events, statuses, fetchedAt, connection: 'connected', error: null }),
      setConnection: (connection, error = null) => set({ connection, error }),
      setLoading: (loading) => set({ loading }),
      setAlerts: (p) => set((s) => ({ alerts: { ...s.alerts, ...p } })),
      setShowMedium: (showMedium) => set({ showMedium }),
    }),
    {
      name: 'prop-guard-economic-calendar',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ events: s.events, statuses: s.statuses, fetchedAt: s.fetchedAt, connection: s.connection, error: s.error, alerts: s.alerts, showMedium: s.showMedium }),
    },
  ),
);
