-- Unified Setup Check decision + journal integration.
--  * setup_checks.setup_decision: status (QUALIFIED / WAIT / STAND_DOWN / BLOCKED / NEEDS_INPUT),
--    match score + matched / failed / pending conditions, risk summary, prop-firm rows, reasons.
--  * setup_checks.kind: 'trade_plan' (QUALIFIED, saved with a pending journal trade) or
--    'setup_review' (analysis only — never an executed trade).
--  * pending_trades.origin gains 'setup_check'.
alter table public.setup_checks add column if not exists setup_decision jsonb;
alter table public.setup_checks add column if not exists kind text check (kind is null or kind in ('trade_plan', 'setup_review'));
alter table public.setup_checks add column if not exists setup_type text;

alter table public.pending_trades drop constraint if exists pending_trades_origin_check;
alter table public.pending_trades add constraint pending_trades_origin_check check (origin in ('analyze', 'calculator', 'setup_check'));
