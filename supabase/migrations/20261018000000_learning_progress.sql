-- =====================================================================
-- Prop Guard — dual experience (beginner learning path / experienced).
-- Additive and idempotent.
--
--  * user_preferences.trading_profile.mode ('beginner' | 'experienced') is
--    stored in the existing jsonb column (absent = experienced).
--  * user_preferences.learning_progress: lesson states + quiz scores, the
--    trading-personality result and the applied plan. Both experiences read
--    the same accounts / rules / strategies / journal, so switching mode
--    never deletes anything.
-- =====================================================================

alter table public.user_preferences add column if not exists learning_progress jsonb;
