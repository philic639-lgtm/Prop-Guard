-- =====================================================================
-- Prop Guard — prop-firm rules database
-- Additive and idempotent.
--
-- Rules are stored per firm → program (account type, size, stage) → rule
-- version (effective date). Only VERIFIED versions (official source, reviewer,
-- verification date) are readable by the app; a backend job publishes new
-- versions with the service role (npm run firm-rules:publish). The app never
-- writes here.
-- =====================================================================

create table if not exists public.prop_firms (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  aliases text[] not null default '{}',
  logo_url text,
  website text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.prop_firm_programs (
  id text primary key,
  firm_id text not null references public.prop_firms(id) on delete cascade,
  name text not null,
  family text not null,
  stage text not null check (stage in ('evaluation','funded','live')),
  account_size numeric(14,2) check (account_size is null or account_size > 0),
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists prop_firm_programs_firm_idx on public.prop_firm_programs (firm_id, sort_order);

create table if not exists public.prop_firm_rule_versions (
  id bigint generated always as identity primary key,
  program_id text not null references public.prop_firm_programs(id) on delete cascade,
  rule_version text not null,
  effective_date date not null,
  last_verified_at timestamptz,
  verification_status text not null default 'unverified' check (verification_status in ('verified','unverified')),
  verified_by text,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  notes text,
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now(),
  constraint prop_firm_rule_versions_unique unique (program_id, rule_version),
  -- "Verified" must be backed by evidence — never a guess.
  constraint prop_firm_rule_versions_verified_evidence check (
    verification_status <> 'verified'
    or (last_verified_at is not null and verified_by is not null and jsonb_array_length(sources) > 0)
  )
);
create index if not exists prop_firm_rule_versions_program_idx on public.prop_firm_rule_versions (program_id, effective_date desc);

-- Public read of the catalogue and of verified rules only; no write policies (service role only).
alter table public.prop_firms enable row level security;
alter table public.prop_firm_programs enable row level security;
alter table public.prop_firm_rule_versions enable row level security;

drop policy if exists "prop firms readable" on public.prop_firms;
create policy "prop firms readable" on public.prop_firms for select to anon, authenticated using (active);
drop policy if exists "prop firm programs readable" on public.prop_firm_programs;
create policy "prop firm programs readable" on public.prop_firm_programs for select to anon, authenticated using (active);
drop policy if exists "verified prop firm rules readable" on public.prop_firm_rule_versions;
create policy "verified prop firm rules readable" on public.prop_firm_rule_versions for select to anon, authenticated using (verification_status = 'verified');

-- Accounts remember which firm / program / rule version their rules came from,
-- what was imported and which values the trader overrode.
alter table public.accounts add column if not exists firm_link jsonb;
-- (account rules live in public.prop_rules — fixed from an earlier draft that named account_rules)
alter table public.prop_rules add column if not exists firm_terms jsonb;
