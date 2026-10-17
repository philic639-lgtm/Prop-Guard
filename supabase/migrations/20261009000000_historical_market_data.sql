-- =====================================================================
-- Prop Guard — historical market data (provider-independent)
-- Additive and idempotent. Market-history layer only; user data untouched.
--
--   historical_bars            normalized OHLCV cache (server-only: licensed data)
--   historical_data_coverage   ranges already fetched per instrument/timeframe/provider
--   practice_scenarios         + generated-scenario columns (decision, outcome, provenance)
--   practice_scenario_candles  pre-decision and post-decision bars stored separately
--   practice_attempts          + which data layer each attempt used
-- =====================================================================

-- Bars ------------------------------------------------------------------
create table if not exists public.historical_bars (
  id bigint generated always as identity primary key,
  instrument text not null check (instrument ~ '^[A-Z0-9]{1,8}$'),
  "timestamp" timestamptz not null,
  timeframe text not null check (timeframe in ('1m','5m','15m','1h')),
  open numeric(18,8) not null,
  high numeric(18,8) not null,
  low numeric(18,8) not null,
  close numeric(18,8) not null,
  volume numeric(20,2) not null default 0 check (volume >= 0),
  provider text not null,
  contract_symbol text,
  continuous_symbol text,
  created_at timestamptz not null default now(),
  constraint historical_bars_ohlc_check check (high >= low and open between low and high and close between low and high),
  -- One bar per instrument/timeframe/provider/time — re-ingesting never duplicates.
  constraint historical_bars_unique unique (instrument, timeframe, provider, "timestamp")
);
create index if not exists historical_bars_lookup_idx on public.historical_bars (instrument, timeframe, "timestamp");

-- Coverage --------------------------------------------------------------
create table if not exists public.historical_data_coverage (
  id bigint generated always as identity primary key,
  instrument text not null,
  timeframe text not null check (timeframe in ('1m','5m','15m','1h')),
  provider text not null,
  range_start timestamptz not null,
  range_end timestamptz not null check (range_end > range_start),
  created_at timestamptz not null default now()
);
create index if not exists historical_data_coverage_lookup_idx on public.historical_data_coverage (instrument, timeframe, provider, range_start);

-- Raw licensed bars stay server-side: RLS on, no user policies (service role only).
alter table public.historical_bars enable row level security;
alter table public.historical_data_coverage enable row level security;

-- Scenarios ---------------------------------------------------------------
alter table public.practice_scenarios add column if not exists strategy_name text;
alter table public.practice_scenarios add column if not exists strategy_version text;
alter table public.practice_scenarios add column if not exists timeframe text;
alter table public.practice_scenarios add column if not exists scenario_start timestamptz;
alter table public.practice_scenarios add column if not exists decision_timestamp timestamptz;
alter table public.practice_scenarios add column if not exists scenario_end timestamptz;
alter table public.practice_scenarios add column if not exists market_session text;
alter table public.practice_scenarios add column if not exists valid_setup boolean;
alter table public.practice_scenarios add column if not exists entry_price numeric(18,8);
alter table public.practice_scenarios add column if not exists stop_price numeric(18,8);
alter table public.practice_scenarios add column if not exists target_price numeric(18,8);
alter table public.practice_scenarios add column if not exists outcome text;
alter table public.practice_scenarios add column if not exists outcome_ambiguous boolean not null default false;
alter table public.practice_scenarios add column if not exists max_favorable_excursion numeric(10,2);
alter table public.practice_scenarios add column if not exists max_adverse_excursion numeric(10,2);
alter table public.practice_scenarios add column if not exists rr_achieved numeric(10,2);
alter table public.practice_scenarios add column if not exists historical boolean not null default false;
alter table public.practice_scenarios add column if not exists data_provider text;
alter table public.practice_scenarios add column if not exists features jsonb;

alter table public.practice_scenarios drop constraint if exists practice_scenarios_source_kind_check;
alter table public.practice_scenarios add constraint practice_scenarios_source_kind_check
  check (source_kind in ('educational_sample','simulated','historical'));
alter table public.practice_scenarios drop constraint if exists practice_scenarios_outcome_check;
alter table public.practice_scenarios add constraint practice_scenarios_outcome_check
  check (outcome is null or outcome in ('target','stop','open'));
-- Only recorded market data may be verified (the earlier constraint also requires source_kind = 'historical').
alter table public.practice_scenarios drop constraint if exists practice_scenarios_verified_is_historical;
alter table public.practice_scenarios add constraint practice_scenarios_verified_is_historical
  check (not verified or historical);

create index if not exists practice_scenarios_similarity_idx
  on public.practice_scenarios (strategy_id, instrument, verified) where historical;
create index if not exists practice_scenarios_decision_idx on public.practice_scenarios (decision_timestamp desc);

create table if not exists public.practice_scenario_candles (
  scenario_id text not null references public.practice_scenarios (id) on delete cascade,
  phase text not null check (phase in ('pre','post')),
  bars jsonb not null,
  primary key (scenario_id, phase)
);
alter table public.practice_scenario_candles enable row level security;
drop policy if exists "candles readable" on public.practice_scenario_candles;
create policy "candles readable" on public.practice_scenario_candles
  for select to authenticated
  using (exists (select 1 from public.practice_scenarios s where s.id = scenario_id and s.is_active));

-- Attempts: remember which data layer an attempt used --------------------
alter table public.practice_attempts add column if not exists scenario_source text
  check (scenario_source is null or scenario_source in ('educational_sample','simulated','historical'));
alter table public.practice_attempts add column if not exists scenario_verified boolean;
