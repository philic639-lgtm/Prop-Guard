-- =====================================================================
-- Prop Guard — account screenshot import.
-- Additive and idempotent.
--
--  * accounts.import_state: confirmed screenshot values and a dated history
--    of confirmed updates ({ fingerprint, maskedId, reported, history[] }).
--    - fingerprint is a ONE-WAY hash of the account number shown on the
--      dashboard (duplicate detection); the number itself is never stored.
--    - Screenshots are NOT stored: OCR runs on the device, and the optional
--      advanced reader (ai-gateway task account_screenshot_v2) receives a
--      redacted copy in memory only.
--  * A partial unique index stops two accounts of the same user from
--    carrying the same dashboard fingerprint (no duplicate imports).
-- =====================================================================

alter table public.accounts add column if not exists import_state jsonb;

create unique index if not exists accounts_user_import_fingerprint_uniq
  on public.accounts (user_id, (import_state->>'fingerprint'))
  where import_state->>'fingerprint' is not null;
