import { useCallback, useEffect, useMemo, useState } from 'react';

import { calendarFreshness, DEFAULT_INSTRUMENTS, DEFAULT_NEWS_RULES, ET, newsRisk, upcoming, validZone, type NewsRuleConfig } from '@/lib/engines/economicCalendar';
import { planEconAlerts } from '@/lib/engines/economicCalendar/alerts';
import { readEconomicCalendar } from '@/services/economicCalendarService';
import { applyEconAlerts } from '@/services/econNotifications';
import { notificationService } from '@/services/notificationService';
import { useAppStore } from '@/store/useAppStore';

import { useEconomicCalendarStore } from './useEconomicCalendarStore';

const REFRESH_AFTER_MS = 30 * 60_000;
let inFlight: Promise<void> | null = null;

/** Re-plan phone alerts from the cached calendar (idempotent — see `diffEconAlerts`). */
export async function syncEconAlerts(now = new Date()) {
  if (!notificationService.supported) return null;
  const { events, alerts } = useEconomicCalendarStore.getState();
  const prefs = useAppStore.getState().preferences;
  return applyEconAlerts(planEconAlerts(events, alerts, now, rulesFor(prefs.markets, false, prefs.timezone)));
}

/** Refresh from the backend (one request at a time), then re-plan alerts. */
export function refreshEconomicCalendar(): Promise<void> {
  if (inFlight) return inFlight;
  const st = useEconomicCalendarStore.getState();
  st.setLoading(true);
  inFlight = (async () => {
    const r = await readEconomicCalendar();
    if (r.status === 'ok') st.setCalendar(r);
    else if (r.status === 'not_configured') st.setConnection('not_configured');
    else st.setConnection('error', r.message); // cached events stay, marked by their age
    await syncEconAlerts().catch(() => null);
  })().finally(() => {
    st.setLoading(false);
    inFlight = null;
  });
  return inFlight;
}

/** The trader's own markets decide which instruments the rules apply to (ES/MES/NQ/MNQ family). */
export function rulesFor(markets: string[] | undefined, showMedium = false, timezone?: string): NewsRuleConfig {
  const mine = (markets ?? []).map((m) => m.toUpperCase()).filter((m) => (DEFAULT_INSTRUMENTS as readonly string[]).includes(m));
  return { ...DEFAULT_NEWS_RULES, instruments: mine, minImpact: showMedium ? 'medium' : 'high', displayZone: displayZone(timezone) };
}

/** The trader's zone (Trading preferences), else this device's zone, else Eastern. */
export function displayZone(timezone?: string | null): string {
  return validZone(timezone) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? ET;
}

export function useEconomicCalendar(opts: { autoRefresh?: boolean } = {}) {
  const events = useEconomicCalendarStore((s) => s.events);
  const statuses = useEconomicCalendarStore((s) => s.statuses);
  const fetchedAt = useEconomicCalendarStore((s) => s.fetchedAt);
  const connection = useEconomicCalendarStore((s) => s.connection);
  const error = useEconomicCalendarStore((s) => s.error);
  const loading = useEconomicCalendarStore((s) => s.loading);
  const showMedium = useEconomicCalendarStore((s) => s.showMedium);
  const markets = useAppStore((s) => s.preferences.markets);
  const timezone = useAppStore((s) => s.preferences.timezone);
  const updates = useEconomicCalendarStore((s) => s.updates);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (opts.autoRefresh === false) return;
    const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Infinity;
    if (age > REFRESH_AFTER_MS && !loading) void refreshEconomicCalendar();
    // Only on mount / when the cache ages — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchedAt]);

  const cfg = useMemo(() => rulesFor(markets, showMedium, timezone), [markets, showMedium, timezone]);
  const tradesIndexFutures = cfg.instruments.length > 0;
  const risk = useMemo(() => newsRisk(events, now, cfg), [events, now, cfg]);
  const list = useMemo(() => upcoming(events, now, 14, cfg), [events, now, cfg]);
  const freshness = useMemo(() => calendarFreshness(statuses, now), [statuses, now]);
  const updatesFreshness = useMemo(() => calendarFreshness(statuses, now, 36, ['bls_updates', 'fed_updates']), [statuses, now]);
  const refresh = useCallback(() => refreshEconomicCalendar(), []);

  return { events, statuses, updates, fetchedAt, connection, error, loading, risk, list, freshness, updatesFreshness, tradesIndexFutures, cfg, now, refresh };
}
