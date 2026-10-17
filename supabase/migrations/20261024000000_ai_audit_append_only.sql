-- =====================================================================
-- Prop Guard — make the AI audit trail append-only for users. Additive.
-- The ai-gateway function counts a user's own ai_analysis rows for its
-- hourly cost limit. With the generic "owner access" (ALL) policy a user
-- could delete those rows and reset the limit, so users may now only read
-- and insert their own rows. Account deletion still removes them (the
-- user_id foreign key cascades from auth.users).
-- =====================================================================

drop policy if exists "owner access" on public.ai_analysis;
drop policy if exists "owner read" on public.ai_analysis;
drop policy if exists "owner insert" on public.ai_analysis;

create policy "owner read" on public.ai_analysis
  for select using (user_id = auth.uid());

create policy "owner insert" on public.ai_analysis
  for insert with check (user_id = auth.uid());

revoke update, delete on public.ai_analysis from anon, authenticated;
