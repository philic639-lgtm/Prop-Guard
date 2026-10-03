-- =====================================================================
-- Prop Guard — trade plans, practice mode, trading profile, followed plan
-- =====================================================================

alter table public.trades add column if not exists followed_plan boolean;

alter table public.user_preferences
  add column if not exists trading_profile jsonb not null default '{}';

create table public.trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  instrument text not null check (instrument in ('ES','MES','NQ','MNQ')),
  direction text not null check (direction in ('long','short')),
  entry numeric(12,4) not null,
  stop numeric(12,4) not null,
  target numeric(12,4),
  contracts integer not null check (contracts > 0),
  risk_dollars numeric(14,2) not null,
  reward_dollars numeric(14,2),
  rr numeric(8,2),
  match_pct integer not null check (match_pct between 0 and 100),
  grade text not null,
  conditions_met integer not null,
  conditions_total integer not null,
  notes text not null default '',
  status text not null default 'saved' check (status in ('saved','executed','discarded')),
  created_at timestamptz not null default now()
);
create index trade_plans_user_idx on public.trade_plans (user_id, created_at desc);

create table public.practice_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete cascade,
  screenshot_path text,
  answers jsonb not null default '{}',
  match_pct integer not null check (match_pct between 0 and 100),
  conditions_met integer not null,
  conditions_total integer not null,
  verdict text not null check (verdict in ('match','wait','no_trade')),
  feedback text not null default '',
  created_at timestamptz not null default now()
);
create index practice_runs_user_idx on public.practice_runs (user_id, created_at desc);

alter table public.trade_plans enable row level security;
alter table public.practice_runs enable row level security;

create policy "owner access" on public.trade_plans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner access" on public.practice_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Allow the new AI tasks in the audit trail.
alter table public.ai_analysis drop constraint if exists ai_analysis_kind_check;
alter table public.ai_analysis add constraint ai_analysis_kind_check
  check (kind in ('setup','screenshot','session_review','strategy_finder','daily_coach','strategy_parse','account_screenshot','practice'));
