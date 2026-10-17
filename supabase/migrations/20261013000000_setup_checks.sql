-- =====================================================================
-- Prop Guard — AI Setup Validation
-- Additive and idempotent.
--
--   setup_checks                 saved checks: chart vs the trader's SAVED rules
--                                (decision computed by the app, never the model)
--   setup_validation_requests    per-user request log used for rate limiting
--   trades / pending_trades      + setup_check_id link (analytics: QUALIFIED
--                                taken vs WAIT / STAND DOWN taken anyway)
-- Screenshots stay in the private `screenshots` bucket (user folder); only
-- the storage path is stored here.
-- =====================================================================

create table if not exists public.setup_checks (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  version int not null default 1,
  account_id uuid,
  strategy_id text not null,
  strategy_name text not null,
  instrument text not null check (char_length(instrument) between 1 and 12),
  timeframe text,
  direction text not null check (direction in ('long','short','unsure')),
  decision text not null check (decision in ('QUALIFIED','WAIT','STAND_DOWN')),
  score int check (score is null or score between 0 and 100),
  grade text check (grade is null or grade in ('A','B','C','WEAK')),
  grade_label text not null default '',
  why text not null default '',
  next_steps jsonb not null default '[]'::jsonb check (jsonb_typeof(next_steps) = 'array'),
  required_total int not null default 0,
  required_passed int not null default 0,
  -- Rule-by-rule results: ruleId, ruleName, status, evidence, confidence, required, weight, kind, origin.
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  chart jsonb not null default '{}'::jsonb,
  risk jsonb not null default '{}'::jsonb,
  image_quality jsonb not null default '{}'::jsonb,
  evidence_confidence int not null default 0 check (evidence_confidence between 0 and 100),
  summary text not null default '',
  notes text not null default '' check (char_length(notes) <= 2000),
  screenshot_path text,
  provider text not null check (provider in ('ai','mock')),
  model text,
  trade_id uuid
);
create index if not exists setup_checks_user_idx on public.setup_checks (user_id, created_at desc);
create index if not exists setup_checks_analytics_idx on public.setup_checks (user_id, decision, strategy_id);
create index if not exists setup_checks_trade_idx on public.setup_checks (trade_id) where trade_id is not null;

alter table public.setup_checks enable row level security;
drop policy if exists "owner access" on public.setup_checks;
create policy "owner access" on public.setup_checks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rate-limit log — written ONLY by the setup-validation Edge Function with the
-- service role, so users cannot alter their own counts. Users may read theirs.
create table if not exists public.setup_validation_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  model text,
  rules int not null default 0,
  status text not null default 'started' check (status in ('started','ok','error'))
);
create index if not exists setup_validation_requests_user_idx on public.setup_validation_requests (user_id, created_at desc);

alter table public.setup_validation_requests enable row level security;
drop policy if exists "owner read" on public.setup_validation_requests;
create policy "owner read" on public.setup_validation_requests for select using (user_id = auth.uid());
drop policy if exists "owner insert" on public.setup_validation_requests;
drop policy if exists "owner update" on public.setup_validation_requests;

-- Links from trades back to the check they were taken from.
alter table public.trades add column if not exists setup_check_id uuid;
alter table public.pending_trades add column if not exists setup_check_id uuid;
create index if not exists trades_setup_check_idx on public.trades (setup_check_id) where setup_check_id is not null;
