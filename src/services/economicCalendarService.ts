import type { SupabaseClient } from '@supabase/supabase-js';

import { rowToEvent, rowToStatus, rowToUpdate, type EconomicEvent, type FeedStatus, type OfficialUpdate } from '@/lib/engines/economicCalendar';

import { supabase as defaultClient } from './supabase/client';

/**
 * Reads the economic calendar the backend refreshed from official sources. Public data: works
 * signed in or out. Without a configured backend there is NO calendar — the app says so instead
 * of showing an empty "all clear" or sample events.
 */
export type CalendarRead = { status: 'ok'; events: EconomicEvent[]; statuses: FeedStatus[]; updates: OfficialUpdate[]; fetchedAt: string } | { status: 'not_configured' } | { status: 'error'; message: string };

const DAYS_BACK = 1;
const DAYS_AHEAD = 21;
const UPDATES_DAYS = 14;
/** Offline, or a host that blocks outside connections (e.g. a sandboxed preview frame). */
const UNREACHABLE = 'The calendar server could not be reached. Check your connection — a preview that blocks outside connections cannot load it.';

export async function readEconomicCalendar(client: SupabaseClient | null = defaultClient, now = new Date()): Promise<CalendarRead> {
  if (!client) return { status: 'not_configured' };
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  try {
    const [ev, st, up] = await Promise.all([
      client.from('economic_events').select('*').gte('date_et', day(-DAYS_BACK)).lte('date_et', day(DAYS_AHEAD)).order('date_et').limit(500),
      client.from('economic_feed_status').select('*'),
      client.from('economic_updates').select('*').gte('published_at', new Date(now.getTime() - UPDATES_DAYS * 86_400_000).toISOString()).order('published_at', { ascending: false }).limit(30),
    ]);
    const err = ev.error ?? st.error;
    if (err) return { status: 'error', message: /fetch|network|load failed/i.test(err.message) ? UNREACHABLE : `The calendar server answered with an error (${err.message.slice(0, 120)}).` };
    // The update list is optional: a backend without it (older migration) still serves the calendar.
    return { status: 'ok', events: (ev.data ?? []).map(rowToEvent), statuses: (st.data ?? []).map(rowToStatus), updates: up.error ? [] : (up.data ?? []).map(rowToUpdate), fetchedAt: now.toISOString() };
  } catch {
    return { status: 'error', message: UNREACHABLE };
  }
}
