-- =====================================================================
-- Prop Guard — official update feeds for the economic calendar. Additive.
-- BLS "latest releases" RSS and the Federal Reserve monetary-policy press
-- releases RSS, stored as published (title, link, publication time) —
-- no numbers, forecasts or results are read out of them.
-- Written by the `economic-calendar-sync` Edge Function (service role);
-- public reference data: everyone may read.
-- =====================================================================

create table if not exists public.economic_updates (
  id text primary key,                       -- feed + the item's own guid / link: re-reading never duplicates
  feed text not null check (feed in ('bls_updates', 'fed_updates')),
  title text not null,
  link text not null check (link ~ '^https://'),
  published_at timestamptz,                  -- from the feed; null when it gives none
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists economic_updates_published_idx on public.economic_updates (published_at desc);

-- The status table also tracks the two update feeds.
alter table public.economic_feed_status drop constraint if exists economic_feed_status_source_check;
alter table public.economic_feed_status add constraint economic_feed_status_source_check check (source in ('bls', 'bea', 'fed', 'bls_updates', 'fed_updates'));

alter table public.economic_updates enable row level security;
drop policy if exists "economic updates readable" on public.economic_updates;
create policy "economic updates readable" on public.economic_updates for select to anon, authenticated using (true);
revoke insert, update, delete on public.economic_updates from anon, authenticated;
grant select on public.economic_updates to anon, authenticated;
