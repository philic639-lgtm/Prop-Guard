-- =====================================================================
-- Prop Guard — automated prop-firm account setup + rule maintenance.
-- Additive and idempotent.
--
--  * prop_firm_programs.line / options: product line ("LucidPro") and the
--    purchase options that change the rules (e.g. Daily Loss Limit On/Off).
--  * prop_rules.rule_calc: typed calculations loaded from a VERIFIED firm
--    configuration (trailing-lock offset, daily-loss mode / scaling, payout
--    rules) — dropped for rules the trader overrides.
--  * prop_firm_sources / prop_firm_source_checks / prop_firm_rule_reviews:
--    the low-cost monitor. A scheduled job re-checks official source pages
--    (conditional requests + content hash, no AI), keeps a full check
--    history, and flags changes for HUMAN review. Nothing is published
--    automatically; a reviewer publishes a NEW rule version and every
--    previous version is kept (prop_firm_rule_versions is append-only).
-- =====================================================================

alter table public.prop_firm_programs add column if not exists line text;
alter table public.prop_firm_programs add column if not exists options jsonb not null default '[]'::jsonb;
alter table public.prop_rules add column if not exists rule_calc jsonb;

create table if not exists public.prop_firm_sources (
  url text primary key check (url ~ '^https://'),
  title text,
  firm_id text not null references public.prop_firms(id) on delete cascade,
  program_ids text[] not null default '{}',
  content_hash text,
  etag text,
  last_modified text,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  consecutive_failures int not null default 0,
  last_status text not null default 'new' check (last_status in ('new','unchanged','changed','blocked','unreachable')),
  created_at timestamptz not null default now()
);
create index if not exists prop_firm_sources_due_idx on public.prop_firm_sources (next_check_at nulls first);

create table if not exists public.prop_firm_source_checks (
  id bigint generated always as identity primary key,
  url text not null references public.prop_firm_sources(url) on delete cascade,
  checked_at timestamptz not null default now(),
  http_status int not null,
  status text not null,
  content_hash text,
  reason text
);
create index if not exists prop_firm_source_checks_url_idx on public.prop_firm_source_checks (url, checked_at desc);

create table if not exists public.prop_firm_rule_reviews (
  id bigint generated always as identity primary key,
  url text not null references public.prop_firm_sources(url) on delete cascade,
  firm_id text not null,
  program_ids text[] not null default '{}',
  detected_at timestamptz not null default now(),
  previous_hash text,
  new_hash text,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','republished','no_rule_change','dismissed')),
  reviewed_by text,
  reviewed_at timestamptz,
  notes text
);
create index if not exists prop_firm_rule_reviews_pending_idx on public.prop_firm_rule_reviews (status, detected_at desc);
-- At most one open review per source.
create unique index if not exists prop_firm_rule_reviews_one_pending on public.prop_firm_rule_reviews (url) where status = 'pending';

-- Service role only (no policies → no anon / authenticated access).
alter table public.prop_firm_sources enable row level security;
alter table public.prop_firm_source_checks enable row level security;
alter table public.prop_firm_rule_reviews enable row level security;

-- Scheduling (run once per project, after deploying the function and setting
-- FIRM_RULES_MONITOR_SECRET; requires the pg_cron + pg_net extensions):
--
--   select cron.schedule('firm-rules-monitor', '17 6 * * 1', $$
--     select net.http_post(
--       url := 'https://<project-ref>.functions.supabase.co/firm-rules-monitor',
--       headers := jsonb_build_object('x-monitor-secret', '<FIRM_RULES_MONITOR_SECRET>')
--     );
--   $$);
--
-- Weekly (Monday 06:17 UTC); each run checks at most 25 due sources.
