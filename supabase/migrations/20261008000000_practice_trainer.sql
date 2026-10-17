-- =====================================================================
-- Prop Guard — Historical Trading Trainer
-- Additive only. Keeps the three data layers separate:
--   * practice_scenarios  MARKET HISTORY  (shared, read-only to users)
--   * practice_attempts   USER PERFORMANCE (owner only; never journal trades)
--   * practice_lessons    USER PERFORMANCE (saved lessons shown in the Journal)
-- Strategy knowledge stays in the app's Strategy Library / strategy_templates.
-- =====================================================================

-- Market history ------------------------------------------------------
create table if not exists public.practice_scenarios (
  id text primary key check (id ~ '^[a-z0-9-]{3,80}$'),
  instrument text not null check (instrument ~ '^[A-Z0-9]{1,8}$'),
  strategy_id text not null,
  session_date date not null,
  session text not null check (session in ('morning','afternoon')),
  difficulty text not null check (difficulty in ('Beginner','Intermediate','Advanced')),
  direction text not null check (direction in ('long','short')),
  quality text not null default 'standard' check (quality in ('great','standard','trap')),
  -- Provenance: only 'historical' + verified rows may ever feed statistics.
  source_kind text not null check (source_kind in ('educational_sample','historical')),
  verified boolean not null default false,
  provider text,
  -- Candles, levels, ideal decision/trade, characteristics and outcome as stored by the app.
  definition jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint practice_scenarios_verified_needs_history check (not verified or source_kind = 'historical')
);
create index if not exists practice_scenarios_lookup_idx on public.practice_scenarios (instrument, strategy_id, is_active);

alter table public.practice_scenarios enable row level security;
drop policy if exists "scenarios readable" on public.practice_scenarios;
create policy "scenarios readable" on public.practice_scenarios
  for select to authenticated using (is_active);
-- Writes are service-role only (data pipeline).

-- User performance: attempts ------------------------------------------
create table if not exists public.practice_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- No FK: scenarios may come from the bundled sample set or the table above.
  scenario_id text not null,
  instrument text not null,
  strategy_id text not null,
  strategy_name text not null,
  attempted_at timestamptz not null default now(),
  mode text not null default 'standard' check (mode in ('standard','smart','great')),
  session text not null check (session in ('morning','afternoon')),
  direction text not null check (direction in ('long','short')),
  decision text not null check (decision in ('long','short','wait')),
  ideal_decision text not null check (ideal_decision in ('long','short','wait')),
  correct boolean not null,
  entry numeric(18,8),
  stop numeric(18,8),
  target numeric(18,8),
  risk_reward numeric(8,2),
  score integer not null check (score between 0 and 100),
  grade text not null check (grade in ('A+','A','B','C','D')),
  result text not null check (result in ('win','loss','expired','not-filled','correct-wait','incorrect-wait')),
  mistakes jsonb not null default '[]',
  setup_characteristics jsonb not null default '{}'
);
create index if not exists practice_attempts_user_idx on public.practice_attempts (user_id, attempted_at desc);

alter table public.practice_attempts enable row level security;
drop policy if exists "owner access" on public.practice_attempts;
create policy "owner access" on public.practice_attempts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- User performance: saved lessons -------------------------------------
create table if not exists public.practice_lessons (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id uuid not null,
  scenario_id text not null,
  strategy_id text not null,
  strategy_name text not null,
  instrument text not null,
  score integer not null check (score between 0 and 100),
  grade text not null,
  lesson text not null,
  created_at timestamptz not null default now()
);
create index if not exists practice_lessons_user_idx on public.practice_lessons (user_id, created_at desc);

alter table public.practice_lessons enable row level security;
drop policy if exists "owner access" on public.practice_lessons;
create policy "owner access" on public.practice_lessons
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
