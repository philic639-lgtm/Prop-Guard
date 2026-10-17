-- =====================================================================
-- Prop Guard — Setup Check engine (rule alignment, separate risk / prop
-- results, server-side evidence tied to image / strategy version / inputs).
-- Additive and idempotent.
-- =====================================================================

-- Safety net for projects that applied an earlier draft of 20261011:
-- account firm terms live on prop_rules (written by the app's account sync).
alter table public.prop_rules add column if not exists firm_terms jsonb;

-- Server-side analyses: vision evidence is stored with the exact image hash,
-- saved-strategy version and input key it belongs to, and expires.
alter table public.setup_validation_requests add column if not exists kind text not null default 'analyze';
alter table public.setup_validation_requests add column if not exists analysis_key text;
alter table public.setup_validation_requests add column if not exists image_sha256 text;
alter table public.setup_validation_requests add column if not exists strategy_id text;
alter table public.setup_validation_requests add column if not exists strategy_version text;
alter table public.setup_validation_requests add column if not exists instrument text;
alter table public.setup_validation_requests add column if not exists analysis_mode text;
alter table public.setup_validation_requests add column if not exists evidence jsonb not null default '[]'::jsonb;
alter table public.setup_validation_requests add column if not exists expires_at timestamptz;
alter table public.setup_validation_requests drop constraint if exists setup_validation_requests_kind_check;
alter table public.setup_validation_requests add constraint setup_validation_requests_kind_check check (kind in ('analyze','evaluate'));
create index if not exists setup_validation_requests_kind_idx on public.setup_validation_requests (user_id, kind, created_at desc);

-- Saved Setup Checks: new decision values and separate metrics.
alter table public.setup_checks drop constraint if exists setup_checks_decision_check;
alter table public.setup_checks add constraint setup_checks_decision_check check (decision in ('TAKE TRADE','WAIT','STAND DOWN','QUALIFIED','STAND_DOWN'));
alter table public.setup_checks drop constraint if exists setup_checks_provider_check;
alter table public.setup_checks add constraint setup_checks_provider_check check (provider in ('ai','mock','none'));
alter table public.setup_checks add column if not exists analysis_mode text check (analysis_mode is null or analysis_mode in ('REAL','DEMO','UNAVAILABLE'));
alter table public.setup_checks add column if not exists risk_check text;
alter table public.setup_checks add column if not exists prop_compliance text;
alter table public.setup_checks add column if not exists risk_checks jsonb not null default '[]'::jsonb;
alter table public.setup_checks add column if not exists prop_checks jsonb not null default '[]'::jsonb;
alter table public.setup_checks add column if not exists blockers jsonb not null default '[]'::jsonb;
alter table public.setup_checks add column if not exists inputs jsonb not null default '{}'::jsonb;
alter table public.setup_checks add column if not exists strategy_version text;
alter table public.setup_checks add column if not exists analysis_key text;
alter table public.setup_checks add column if not exists evaluated_by text check (evaluated_by is null or evaluated_by in ('server','device'));
alter table public.setup_checks add column if not exists analysis_id bigint;
