-- =====================================================================
-- Prop Guard — expanded strategy library
-- Additive only: no existing table, column or row is dropped.
--
-- * strategies.source_type  BUILT_IN | CUSTOM | AI_ADAPTED (backfilled)
-- * trades.strategy_name    snapshot so the journal keeps the name
-- * strategy_templates      optional server-managed templates (read-only to users).
--                           The app ships its 30 built-ins in code; rows here are
--                           for future templates and for attaching REAL backtest
--                           data (is_backtested / performance_data) — never sample data.
-- * strategy_performance    view of each user's own closed-trade results by strategy
--
-- User strategies stay in `strategies` (+ `strategy_rules` for checklists);
-- the strategy traded in a pre-trade session is `sessions.strategy_id`;
-- a trade's strategy link is `trades.strategy_id`.
-- =====================================================================

-- Strategy source type ------------------------------------------------
alter table public.strategies add column if not exists source_type text;
update public.strategies
  set source_type = case when source = 'library' then 'BUILT_IN' else 'CUSTOM' end
  where source_type is null;
alter table public.strategies drop constraint if exists strategies_source_type_check;
alter table public.strategies add constraint strategies_source_type_check
  check (source_type is null or source_type in ('BUILT_IN','CUSTOM','AI_ADAPTED'));
create index if not exists strategies_library_idx on public.strategies (user_id, library_id) where library_id is not null;

-- Strategy name snapshot on trades ------------------------------------
alter table public.trades add column if not exists strategy_name text;
update public.trades t
  set strategy_name = s.name
  from public.strategies s
  where t.strategy_id = s.id and t.strategy_name is null;
create index if not exists trades_user_strategy_idx on public.trades (user_id, strategy_id);

-- Server-managed strategy templates -----------------------------------
create table if not exists public.strategy_templates (
  id text primary key check (id ~ '^[a-z0-9-]{2,64}$'),
  name text not null,
  category text not null check (category in ('opening_range','vwap','trend','breakout','support_resistance','previous_day','liquidity','opening_session')),
  definition jsonb not null,
  version integer not null default 1,
  is_backtested boolean not null default false,
  -- Only real, attributable results: {source, period, sampleSize, winRate, avgR}
  performance_data jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint strategy_templates_backtest_requires_data check (not is_backtested or performance_data is not null)
);

alter table public.strategy_templates enable row level security;
drop policy if exists "templates readable" on public.strategy_templates;
create policy "templates readable" on public.strategy_templates
  for select to authenticated using (is_active);
-- No insert/update/delete policies: templates are managed with the service role only.

-- Personal performance by strategy (own trades only) ------------------
create or replace view public.strategy_performance
with (security_invoker = true) as
select
  t.user_id,
  t.account_id,
  t.strategy_id,
  coalesce(s.name, t.strategy_name, 'Strategy not assigned') as strategy_name,
  s.library_id,
  count(*)::int as trades,
  count(*) filter (where t.pnl > 0)::int as wins,
  count(*) filter (where t.pnl < 0)::int as losses,
  round(avg(t.realized_r)::numeric, 2) as avg_r,
  round(coalesce(sum(t.realized_r), 0)::numeric, 2) as net_r,
  round(coalesce(sum(t.pnl), 0)::numeric, 2) as net_pnl,
  max(coalesce(t.closed_at, t.opened_at)) as last_trade_at
from public.trades t
left join public.strategies s on s.id = t.strategy_id
where t.status = 'closed' and t.pnl is not null
group by t.user_id, t.account_id, t.strategy_id, coalesce(s.name, t.strategy_name, 'Strategy not assigned'), s.library_id;

grant select on public.strategy_performance to authenticated;
