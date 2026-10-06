-- ICC (Indication, Correction, Continuation) Setup Check: the ICC SETUP card
-- computed at save time (entry status, stage-quality score, levels, R:R).
alter table public.setup_checks add column if not exists icc jsonb;
