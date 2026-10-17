import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { alertLeads, DEFAULT_ALERT_SETTINGS, type EconAlertSettings } from '@/lib/engines/economicCalendar/alerts';
import type { EconomicEvent, FeedStatus, OfficialUpdate } from '@/lib/engines/economicCalendar';

/**
 * Device cache of the economic calendar (last successful read from the Prop Guard backend)
 * and the trader's alert settings. Kept apart from the trading data: it is public reference
 * data, safe to drop and refetch.
 */
export type CalendarConnection = 'connected' | 'not_configured' | 'error' | 'never';

interface EconState {
  events: EconomicEvent[];
  statuses: FeedStatus[];
  /** Latest items of the official update feeds (BLS releases, Fed monetary-policy press). */
  updates: OfficialUpdate[];
  /** When this device last read the calendar from the backend SUCCESSFULLY. */
  fetchedAt: string | null;
  /** When this device last TRIED (success or failure) — shown with the result, never as "never" after an attempt. */
  lastCheckedAt: string | null;
  connection: CalendarConnection;
  error: string | null;
  loading: boolean;
  alerts: EconAlertSettings;
  /** Min impact for the list / banners ("high" by default; "medium" shows more). */
  showMedium: boolean;
  setCalendar: (p: { events: EconomicEvent[]; statuses: FeedStatus[]; updates: OfficialUpdate[]; fetchedAt: string }) => void;
  setConnection: (c: CalendarConnection, error?: string | null, at?: string) => void;
  setLoading: (v: boolean) => void;
  setAlerts: (p: Partial<EconAlertSettings>) => void;
  setShowMedium: (v: boolean) => void;
}

export const useEconomicCalendarStore = create<EconState>()(
  persist(
    (set) => ({
      events: [],
      statuses: [],
      updates: [],
      fetchedAt: null,
      lastCheckedAt: null,
      connection: 'never',
      error: null,
      loading: false,
      alerts: DEFAULT_ALERT_SETTINGS,
      showMedium: false,
      setCalendar: ({ events, statuses, updates, fetchedAt }) => set({ events, statuses, updates, fetchedAt, lastCheckedAt: fetchedAt, connection: 'connected', error: null }),
      setConnection: (connection, error = null, at = new Date().toISOString()) => set({ connection, error, lastCheckedAt: at }),
      setLoading: (loading) => set({ loading }),
      setAlerts: (p) => set((s) => ({ alerts: { ...s.alerts, ...p } })),
      setShowMedium: (showMedium) => set({ showMedium }),
    }),
    {
      name: 'prop-guard-economic-calendar',
      version: 2,
      // v1 stored one `leadMinutes`; v2 stores a list of advance warnings.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as { alerts?: Partial<EconAlertSettings> & { leadMinutes?: number } };
        if (version < 2 && p.alerts) p.alerts = { enabled: p.alerts.enabled === true, minImpact: p.alerts.minImpact ?? 'high', leads: alertLeads(p.alerts) };
        return p as never;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ events: s.events, statuses: s.statuses, updates: s.updates, fetchedAt: s.fetchedAt, lastCheckedAt: s.lastCheckedAt, connection: s.connection, error: s.error, alerts: s.alerts, showMedium: s.showMedium }),
    },
  ),
);
