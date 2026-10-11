-- =====================================================================
-- Prop Guard — economic calendar (SCHEDULED releases only). Additive.
-- Filled by the `economic-calendar-sync` Edge Function from official
-- government calendars (BLS iCalendar, BEA release schedule, Federal
-- Reserve FOMC calendar). No breaking news, no actual / forecast numbers.
-- Public reference data: everyone may read; only the service role writes.
-- =====================================================================

create table if not exists public.economic_events (
  id text primary key,                       -- source:family:date — the same release keeps its id
  source text not null check (source in ('bls', 'bea', 'fed')),
  source_event_id text,
  title text not null,                       -- as the source published it
  name text not null,                        -- normalised display name
  code text not null,
  date_et date not null,                     -- release date, US Eastern
  time_et text check (time_et is null or time_et ~ '^\d{2}:\d{2}$'),
  time_status text not null check (time_status in ('published', 'conventional', 'unknown')),
  starts_at timestamptz,                     -- null when the time is unknown
  source_url text not null,
  retrieved_at timestamptz not null,
  kind text not null default 'scheduled_release' check (kind = 'scheduled_release'),
  active boolean not null default true,      -- false = no longer listed by the source (rescheduled / withdrawn)
  updated_at timestamptz not null default now(),
  check ((time_status = 'unknown') = (starts_at is null))
);
create index if not exists economic_events_starts_idx on public.economic_events (starts_at) where active;
create index if not exists economic_events_date_idx on public.economic_events (date_et) where active;

create table if not exists public.economic_feed_status (
  source text primary key check (source in ('bls', 'bea', 'fed')),
  checked_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'never' check (status in ('ok', 'not_modified', 'error', 'never')),
  error text,
  event_count integer not null default 0,
  coverage_until date,
  etag text,
  last_modified text
);

drop trigger if exists economic_events_updated on public.economic_events;
create trigger economic_events_updated before update on public.economic_events for each row execute function public.set_updated_at();

alter table public.economic_events enable row level security;
alter table public.economic_feed_status enable row level security;

drop policy if exists "economic events readable" on public.economic_events;
create policy "economic events readable" on public.economic_events for select to anon, authenticated using (true);
drop policy if exists "economic feed status readable" on public.economic_feed_status;
create policy "economic feed status readable" on public.economic_feed_status for select to anon, authenticated using (true);

revoke insert, update, delete on public.economic_events, public.economic_feed_status from anon, authenticated;
grant select on public.economic_events, public.economic_feed_status to anon, authenticated;

-- Scheduling (run once per project, after deploying the function and setting
-- ECON_SYNC_SECRET; requires the pg_cron + pg_net extensions):
--
--   select cron.schedule('economic-calendar-sync', '23 */6 * * *', $$
--     select net.http_post(
--       url := 'https://<project-ref>.functions.supabase.co/economic-calendar-sync',
--       headers := jsonb_build_object('x-sync-secret', '<ECON_SYNC_SECRET>')
--     );
--   $$);
--
-- Every 6 hours (4 requests per source per day, conditional — usually "not modified").
