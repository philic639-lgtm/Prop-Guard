-- =====================================================================
-- Prop Guard — automatic journaling
-- Every trade checked in Analyze / Risk Calculator is stored as a pending
-- trade with its full plan snapshot. When the result arrives (trader,
-- screenshot or broker import) it becomes a closed trade in `trades`.
-- =====================================================================

create table public.pending_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  strategy_id uuid references public.strategies (id) on delete set null,
  instrument text not null check (instrument ~ '^[A-Z0-9]{1,8}$'),
  direction text not null check (direction in ('long','short')),
  entry numeric(18,8) not null,
  stop numeric(18,8) not null,
  target numeric(18,8),
  contracts integer not null check (contracts > 0),
  account_balance numeric(14,2),
  risk_dollars numeric(14,2) not null,
  reward_dollars numeric(14,2),
  rr numeric(8,2),
  bias text check (bias in ('bullish','bearish','neutral')),
  checklist jsonb not null default '[]',
  rules_followed text[] not null default '{}',
  rules_violated text[] not null default '{}',
  setup_score integer,
  setup_grade text,
  rule_events jsonb not null default '[]',
  notes text not null default '',
  screenshot_url text,
  origin text not null default 'analyze' check (origin in ('analyze','calculator')),
  status text not null default 'pending' check (status in ('pending','entered','completed','dismissed')),
  -- No FK: trades and pending trades reference each other and sync in either order.
  trade_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pending_trades_user_idx on public.pending_trades (user_id, status, created_at desc);

alter table public.pending_trades enable row level security;
create policy "owner access" on public.pending_trades
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Trades remember their plan context and broker identity.
alter table public.trades add column if not exists account_balance numeric(14,2);
alter table public.trades add column if not exists pending_id uuid;
alter table public.trades add column if not exists external_id text;
-- One broker round trip is imported once per user.
create unique index if not exists trades_user_external_idx on public.trades (user_id, external_id) where external_id is not null;

alter table public.trades drop constraint if exists trades_source_check;
alter table public.trades add constraint trades_source_check check (source in ('manual','screenshot','auto','broker'));
