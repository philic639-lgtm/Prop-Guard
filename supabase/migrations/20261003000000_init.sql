-- =====================================================================
-- Prop Guard — initial schema
-- Every user-owned table carries user_id and is protected by Row Level
-- Security so users can only ever read or write their own rows.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- user_preferences (one row per user; includes personal trading rules)
-- ---------------------------------------------------------------------
create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'America/New_York',
  default_instrument text not null default 'MES' check (default_instrument in ('ES','MES','NQ','MNQ')),
  markets text[] not null default '{ES,MES}',
  trading_type text not null default 'prop' check (trading_type in ('prop','personal','both')),
  prop_firm text not null default '',
  notifications jsonb not null default '{"preSession":true,"lossLimit":true,"tradeLimit":true,"cooldown":true,"journal":true}',
  trading_rules jsonb not null default '{}',
  onboarded boolean not null default false,
  active_account_id uuid,
  active_strategy_id uuid,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  firm text not null default '',
  kind text not null default 'prop' check (kind in ('prop','personal')),
  size numeric(14,2) not null check (size >= 0),
  starting_balance numeric(14,2) not null,
  balance numeric(14,2) not null,
  cycle_start_balance numeric(14,2) not null,
  high_water_mark numeric(14,2) not null,
  status text not null default 'active' check (status in ('active','passed','failed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------------
-- prop_rules (1:1 with accounts; firm-agnostic, fully user configured)
-- ---------------------------------------------------------------------
create table public.prop_rules (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  daily_loss_limit numeric(14,2),
  max_drawdown numeric(14,2),
  drawdown_type text not null default 'trailing' check (drawdown_type in ('static','trailing','eod_trailing')),
  trailing_locks_at_start boolean not null default true,
  profit_target numeric(14,2),
  max_contracts integer check (max_contracts is null or max_contracts > 0),
  consistency_pct numeric(5,2) check (consistency_pct is null or (consistency_pct > 0 and consistency_pct <= 100)),
  min_trading_days integer,
  max_trading_days integer,
  payout_threshold numeric(14,2),
  custom_rules jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
create index prop_rules_user_idx on public.prop_rules (user_id);

-- ---------------------------------------------------------------------
-- strategies + strategy_rules (checklist items)
-- ---------------------------------------------------------------------
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  markets text[] not null default '{}',
  session text not null default '',
  timeframe text not null default '',
  entry_window_start text,
  entry_window_end text,
  bias_requirement text not null default '',
  requires_bias_alignment boolean not null default true,
  entry_trigger text not null default '',
  confirmation_rules text not null default '',
  retest_rules text not null default '',
  stop_method text not null default '',
  typical_stop_min numeric(10,2),
  typical_stop_max numeric(10,2),
  target_method text not null default '',
  min_rr numeric(6,2) not null default 2 check (min_rr > 0),
  max_trades integer not null default 1 check (max_trades > 0),
  invalidation_rules text not null default '',
  notes text not null default '',
  source text not null default 'custom' check (source in ('custom','library')),
  library_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index strategies_user_idx on public.strategies (user_id);

create table public.strategy_rules (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  item_key text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  kind text not null default 'yesno' check (kind in ('yesno','bias')),
  required boolean not null default true,
  position integer not null default 0,
  primary key (strategy_id, item_key)
);
create index strategy_rules_user_idx on public.strategy_rules (user_id);

-- ---------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active','ended')),
  review jsonb,
  created_at timestamptz not null default now()
);
create index sessions_user_date_idx on public.sessions (user_id, date desc);

-- ---------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  session_id uuid references public.sessions (id) on delete set null,
  instrument text not null check (instrument in ('ES','MES','NQ','MNQ')),
  direction text not null check (direction in ('long','short')),
  entry_price numeric(12,4) not null,
  stop_price numeric(12,4) not null,
  original_stop_price numeric(12,4) not null,
  target_price numeric(12,4),
  exit_price numeric(12,4),
  contracts integer not null check (contracts > 0),
  risk_dollars numeric(14,2) not null,
  reward_dollars numeric(14,2),
  r_multiple numeric(8,2),
  realized_r numeric(8,2),
  pnl numeric(14,2),
  points numeric(10,2),
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  bias text check (bias is null or bias in ('bullish','bearish','neutral')),
  rules_followed text[] not null default '{}',
  rules_violated text[] not null default '{}',
  setup_score integer check (setup_score is null or setup_score between 0 and 100),
  setup_grade text,
  discipline_score integer check (discipline_score is null or discipline_score between 0 and 100),
  notes text not null default '',
  screenshot_url text,
  source text not null default 'manual' check (source in ('manual','screenshot')),
  mae numeric(10,2),
  mfe numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trades_user_opened_idx on public.trades (user_id, opened_at desc);
create index trades_account_opened_idx on public.trades (account_id, opened_at desc);
create index trades_strategy_idx on public.trades (strategy_id);
create index trades_session_idx on public.trades (session_id);

create table public.trade_checklists (
  trade_id uuid not null references public.trades (id) on delete cascade,
  item_key text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  value boolean not null,
  primary key (trade_id, item_key)
);
create index trade_checklists_user_idx on public.trade_checklists (user_id);

-- ---------------------------------------------------------------------
-- journal_entries (1:1 with trades)
-- ---------------------------------------------------------------------
create table public.journal_entries (
  trade_id uuid primary key references public.trades (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emotion text check (emotion is null or emotion in ('calm','confident','anxious','frustrated','fomo','tired')),
  setup_rating smallint check (setup_rating is null or setup_rating between 1 and 5),
  ai_summary text,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index journal_entries_user_idx on public.journal_entries (user_id);

-- ---------------------------------------------------------------------
-- screenshots (files live in the private `screenshots` storage bucket)
-- ---------------------------------------------------------------------
create table public.screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id uuid references public.trades (id) on delete set null,
  storage_path text not null,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index screenshots_user_idx on public.screenshots (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- discipline_events
-- ---------------------------------------------------------------------
create table public.discipline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete cascade,
  trade_id uuid references public.trades (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  type text not null check (type in (
    'RULE_FOLLOWED','RULE_OVERRIDDEN','STOP_WIDENED','DAILY_LIMIT_HIT',
    'TRADE_LIMIT_HIT','COOLDOWN_BROKEN','STRATEGY_VIOLATION','JOURNAL_COMPLETED')),
  category text not null check (category in ('risk','entry','trade_limit','stop','cooldown','journal','strategy')),
  detail text not null default '',
  occurred_at timestamptz not null default now()
);
create index discipline_events_user_idx on public.discipline_events (user_id, occurred_at desc);
create index discipline_events_trade_idx on public.discipline_events (trade_id);

-- ---------------------------------------------------------------------
-- notifications (log of scheduled / delivered reminders)
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('pre_session','loss_limit','trade_limit','cooldown','journal','discipline')),
  title text not null,
  body text not null,
  scheduled_for timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- subscription_status (written by a RevenueCat webhook using the service role)
-- ---------------------------------------------------------------------
create table public.subscription_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  entitlement_active boolean not null default false,
  provider text not null default 'revenuecat',
  product_id text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ai_analysis (audit trail of AI outputs; inputs are minimized summaries)
-- ---------------------------------------------------------------------
create table public.ai_analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('setup','screenshot','session_review','strategy_finder','daily_coach')),
  trade_id uuid references public.trades (id) on delete set null,
  input_summary jsonb not null default '{}',
  output jsonb not null,
  provider text not null,
  model text,
  created_at timestamptz not null default now()
);
create index ai_analysis_user_idx on public.ai_analysis (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger prefs_updated before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();
create trigger prop_rules_updated before update on public.prop_rules for each row execute function public.set_updated_at();
create trigger strategies_updated before update on public.strategies for each row execute function public.set_updated_at();
create trigger trades_updated before update on public.trades for each row execute function public.set_updated_at();
create trigger journal_updated before update on public.journal_entries for each row execute function public.set_updated_at();
create trigger subscription_updated before update on public.subscription_status for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- New user bootstrap
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.user_preferences (user_id) values (new.id);
  insert into public.subscription_status (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.accounts enable row level security;
alter table public.prop_rules enable row level security;
alter table public.strategies enable row level security;
alter table public.strategy_rules enable row level security;
alter table public.sessions enable row level security;
alter table public.trades enable row level security;
alter table public.trade_checklists enable row level security;
alter table public.journal_entries enable row level security;
alter table public.screenshots enable row level security;
alter table public.discipline_events enable row level security;
alter table public.notifications enable row level security;
alter table public.subscription_status enable row level security;
alter table public.ai_analysis enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Generic "owner can do everything" policies
do $$
declare t text;
begin
  foreach t in array array[
    'user_preferences','accounts','prop_rules','strategies','strategy_rules','sessions',
    'trades','trade_checklists','journal_entries','screenshots','discipline_events',
    'notifications','ai_analysis'
  ] loop
    execute format(
      'create policy "owner access" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;

-- Subscription status is read-only for clients; only the service role (webhook) writes it.
create policy "read own subscription" on public.subscription_status
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: private screenshots bucket, files stored under <user_id>/...
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('screenshots', 'screenshots', false)
  on conflict (id) do nothing;

create policy "screenshots read own" on storage.objects
  for select using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "screenshots insert own" on storage.objects
  for insert with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "screenshots update own" on storage.objects
  for update using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "screenshots delete own" on storage.objects
  for delete using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
