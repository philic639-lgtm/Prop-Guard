-- =====================================================================
-- Prop Guard — V1 audit fix. Additive and idempotent.
--
-- ai_analysis.kind did not allow 'strategy_analyze' or
-- 'account_screenshot_v2', so the ai-gateway's audit insert for those tasks
-- failed silently (and the per-user hourly AI limit, which counts these rows,
-- under-counted them).
-- =====================================================================

alter table public.ai_analysis drop constraint if exists ai_analysis_kind_check;
alter table public.ai_analysis add constraint ai_analysis_kind_check
  check (kind in ('setup','screenshot','session_review','strategy_finder','daily_coach','strategy_parse','strategy_analyze','account_screenshot','account_screenshot_v2','practice'));
