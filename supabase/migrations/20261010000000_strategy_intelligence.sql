-- Strategy Intelligence: keep the trader's original description next to the
-- structured, provenance-labelled analysis (trader rules / AI interpretations /
-- AI suggestions with accept-edit-reject decisions, health score, behavioral risks).

alter table public.strategies
  add column if not exists original_text text,
  add column if not exists structured jsonb;

alter table public.strategies
  drop constraint if exists strategies_original_text_len;
alter table public.strategies
  add constraint strategies_original_text_len check (original_text is null or char_length(original_text) <= 8000);

-- Requiring bias alignment is opt-in: a strategy without a bias rule must not
-- silently demand one (previous default leaked an ORB-style "1H trend" rule).
alter table public.strategies alter column requires_bias_alignment set default false;
