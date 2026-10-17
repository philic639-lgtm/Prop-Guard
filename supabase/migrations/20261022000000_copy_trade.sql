-- =====================================================================
-- Prop Guard — Copy Trade (assistant only: nothing is executed).
-- Additive and idempotent. Existing trades and accounts are untouched;
-- trades without an origin are the trader's own ('self').
--
--   source_traders   traders the user copies + their copy settings (jsonb)
--   copy_trades      the copy log: idea, translated size/risk as logged, outcome
--   trades.origin    'self' | 'copied' (+ copy_trade_id, source trader id/name)
-- =====================================================================

create table if not exists public.source_traders (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  platform text not null default 'other' check (platform in ('discord','telegram','x','youtube','mentor','friend','other')),
  asset_class text not null default 'futures' check (asset_class in ('futures','options','stocks','forex','crypto','other')),
  instruments jsonb not null default '[]',
  style text,
  notes text not null default '',
  trust_rating smallint check (trust_rating between 1 and 5),
  is_active boolean not null default true,
  archived boolean not null default false,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists source_traders_user_idx on public.source_traders (user_id, updated_at desc);
alter table public.source_traders enable row level security;
drop policy if exists "owner access" on public.source_traders;
create policy "owner access" on public.source_traders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.copy_trades (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_trader_id uuid not null,
  source_trader_name text not null,
  account_id uuid,
  instrument text not null,
  direction text not null check (direction in ('long','short')),
  entry numeric not null,
  stop numeric not null,
  target numeric,
  source_contracts numeric,
  source_instrument text,
  idea_at timestamptz not null,
  setup text not null default '',
  notes text not null default '',
  conviction text check (conviction in ('A+','A','B','C')),
  mode text not null check (mode in ('live','simulated','missed')),
  screenshot_url text,
  contracts integer not null default 0 check (contracts >= 0),
  translation jsonb not null default '{}',
  trade_id uuid,
  outcome jsonb,
  lesson text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists copy_trades_user_idx on public.copy_trades (user_id, idea_at desc);
create index if not exists copy_trades_source_idx on public.copy_trades (user_id, source_trader_id);
alter table public.copy_trades enable row level security;
drop policy if exists "owner access" on public.copy_trades;
create policy "owner access" on public.copy_trades
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.trades add column if not exists origin text not null default 'self';
alter table public.trades drop constraint if exists trades_origin_check;
alter table public.trades add constraint trades_origin_check check (origin in ('self','copied'));
alter table public.trades add column if not exists copy_trade_id uuid;
alter table public.trades add column if not exists source_trader_id uuid;
alter table public.trades add column if not exists source_trader_name text;
create index if not exists trades_source_trader_idx on public.trades (user_id, source_trader_id) where source_trader_id is not null;
