-- =====================================================================
-- Prop Guard — trade screenshot extraction (journal). Additive, idempotent.
--
-- The `trade-screenshot` Edge Function logs each model call (no image, no
-- content) in setup_validation_requests with kind 'trade_screenshot' to
-- enforce per-user per-minute / hour / day limits. Rows are written with the
-- service role; users can only read their own rows (existing RLS).
-- =====================================================================

alter table public.setup_validation_requests drop constraint if exists setup_validation_requests_kind_check;
alter table public.setup_validation_requests add constraint setup_validation_requests_kind_check
  check (kind in ('analyze','evaluate','trade_screenshot'));
