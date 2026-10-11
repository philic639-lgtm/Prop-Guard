import type { SupabaseClient } from '@supabase/supabase-js';

import { rowToEvent, rowToStatus, type EconomicEvent, type FeedStatus } from '@/lib/engines/economicCalendar';

import { supabase as defaultClient } from './supabase/client';

/**
 * Reads the economic calendar the backend refreshed from official sources. Public data: works
 * signed in or out. Without a configured backend there is NO calendar — the app says so instead
 * of showing an empty "all clear" or sample events.
 */
export type CalendarRead = { status: 'ok'; events: EconomicEvent[]; statuses: FeedStatus[]; fetchedAt: string } | { status: 'not_configured' } | { status: 'error'; message: string };

const DAYS_BACK = 1;
const DAYS_AHEAD = 21;

export async function readEconomicCalendar(client: SupabaseClient | null = defaultClient, now = new Date()): Promise<CalendarRead> {
  if (!client) return { status: 'not_configured' };
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  try {
    const [ev, st] = await Promise.all([
      client.from('economic_events').select('*').gte('date_et', day(-DAYS_BACK)).lte('date_et', day(DAYS_AHEAD)).order('date_et').limit(500),
      client.from('economic_feed_status').select('*'),
    ]);
    if (ev.error || st.error) return { status: 'error', message: 'The calendar could not be loaded. Try again later.' };
    return { status: 'ok', events: (ev.data ?? []).map(rowToEvent), statuses: (st.data ?? []).map(rowToStatus), fetchedAt: now.toISOString() };
  } catch {
    return { status: 'error', message: 'The calendar could not be loaded — check your connection.' };
  }
}
