-- =====================================================================
-- Prop Guard — expanded futures instrument catalog + custom instruments
-- Instruments are validated in the app against the central catalog
-- (src/data/instruments.ts) plus each user's custom contracts, so the
-- database no longer hard-codes the ES/MES/NQ/MNQ list.
-- =====================================================================

alter table public.trades drop constraint if exists trades_instrument_check;
alter table public.trades add constraint trades_instrument_check check (instrument ~ '^[A-Z0-9]{1,8}$');

alter table public.trade_plans drop constraint if exists trade_plans_instrument_check;
alter table public.trade_plans add constraint trade_plans_instrument_check check (instrument ~ '^[A-Z0-9]{1,8}$');

alter table public.user_preferences drop constraint if exists user_preferences_default_instrument_check;
alter table public.user_preferences add constraint user_preferences_default_instrument_check check (default_instrument ~ '^[A-Z0-9]{1,8}$');

-- Custom contracts: [{symbol, name, tickSize, tickValue, pointValue, isMicro, ...}]
alter table public.user_preferences add column if not exists custom_instruments jsonb not null default '[]';

-- Finer price precision for FX (6J tick = 0.0000005) and Treasuries (1/64).
alter table public.trades
  alter column entry_price type numeric(18,8),
  alter column stop_price type numeric(18,8),
  alter column original_stop_price type numeric(18,8),
  alter column target_price type numeric(18,8),
  alter column exit_price type numeric(18,8),
  alter column points type numeric(18,8),
  alter column mae type numeric(18,8),
  alter column mfe type numeric(18,8);

alter table public.trade_plans
  alter column entry type numeric(18,8),
  alter column stop type numeric(18,8),
  alter column target type numeric(18,8);
