# Backend deployment checklist

Prop Guard runs fully offline in Demo / local mode. Everything below is only needed for
cloud sync, sign-in and the server-side AI features. Nothing here is deployed
automatically — each step is run by the project owner.

## 1. Database (Supabase Postgres)

```bash
npx supabase link --project-ref <ref>
npx supabase db push            # applies every file in supabase/migrations, in order
```

22 migrations (`20261003000000_init.sql` … `20261024000000_ai_audit_append_only.sql`).
They create 36 tables, one view (`strategy_performance`, `security_invoker`), triggers and
the private `screenshots` storage bucket.

Security model (verified locally, see §5):

| Tables | Who can do what |
| --- | --- |
| User data (`accounts`, `prop_rules`, `strategies`, `strategy_rules`, `sessions`, `trades`, `trade_checklists`, `journal_entries`, `pending_trades`, `trade_plans`, `setup_checks`, `source_traders`, `copy_trades`, `copy_groups`, `practice_*` user rows, `user_preferences`, `profiles`, …) | Owner only (`user_id = auth.uid()`), read + write |
| `ai_analysis` | Owner read + insert only (append-only so the AI hourly limit cannot be reset) |
| `subscription_status`, `setup_validation_requests` | Owner read only; written by the service role (billing webhook / functions) |
| `prop_firms`, `prop_firm_programs`, `prop_firm_rule_versions` | Everyone can read active / **verified** rows; written by `npm run firm-rules:publish` (service role) |
| `practice_scenarios`, `practice_scenario_candles`, `strategy_templates` | Signed-in users read active rows; written server-side |
| `historical_bars`, `historical_data_coverage`, `prop_firm_sources`, `prop_firm_source_checks`, `prop_firm_rule_reviews` | Service role only (no client policies) |
| Storage `screenshots` (private) | Owner's own `<user_id>/…` folder only |

## 2. Edge Functions

```bash
npm run shared:sync                                   # copy the shared engines into supabase/functions/_shared
npx supabase functions deploy ai-gateway
npx supabase functions deploy setup-validation
npx supabase functions deploy trade-screenshot
npx supabase functions deploy firm-rules-monitor --no-verify-jwt   # called by pg_cron with its own secret
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase.

## 3. Secrets (server-side only — `npx supabase secrets set NAME=value`)

| Secret | Used by | Required? |
| --- | --- | --- |
| `AI_PROVIDER` (`anthropic` / `openai`) | ai-gateway | yes, for remote AI |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | ai-gateway | the one matching `AI_PROVIDER` |
| `ANTHROPIC_MODEL`, `OPENAI_MODEL` | ai-gateway | optional |
| `AI_RATE_PER_HOUR` (default 60) | ai-gateway | optional |
| `OPENAI_API_KEY` | setup-validation, trade-screenshot | yes (chart / trade screenshot reading) |
| `OPENAI_VISION_MODEL` | setup-validation (default set in code), trade-screenshot (**required**) | see left |
| `OPENAI_BASE_URL` | all three AI functions | optional (OpenAI-compatible endpoint) |
| `SETUP_CHECK_RATE_PER_HOUR`, `SETUP_CHECK_TIMEOUT_MS` | setup-validation | optional |
| `TRADE_SCREENSHOT_RATE_PER_MINUTE/_HOUR/_DAY`, `TRADE_SCREENSHOT_TIMEOUT_MS` | trade-screenshot | optional |
| `FIRM_RULES_MONITOR_SECRET` | firm-rules-monitor | yes, if the monitor is scheduled |

Without an AI key every feature still works: Setup Check runs in MANUAL mode, account
import uses on-device OCR / manual entry, and the AI reviews fall back to the local engines.

## 4. App configuration (`.env`, public values only)

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_AI_MODE=remote        # Setup Check REMOTE mode + ai-gateway
```

Then sign up in the app: a trigger creates the `profiles`, `user_preferences` and
`subscription_status` rows.

## 5. How the backend was verified (no cloud project needed)

* All migrations applied to a fresh Postgres 16 with a Supabase-compatible `auth` stub —
  no errors; every table has RLS; re-running the newest migration is a no-op.
* `src/services/__tests__/supabaseSchema.integration.test.ts` (opt-in) pushes a full
  dataset through the real `SupabaseRepository` in the app's own sync order, reads it back
  identically, and checks that a second user and signed-out clients see nothing:

  ```bash
  PG_TEST_URL='postgres://postgres@/db?host=/tmp&port=5432' npx jest supabaseSchema
  ```

* The four Edge Functions type-check under strict mode and were run under Deno against
  PostgREST + the migrated database with a mocked OpenAI endpoint: authentication (401),
  strategy / account loading under RLS, vision evidence (REAL / low-confidence ignored /
  provider outage → UNAVAILABLE), image-type spoofing (415), evidence reuse limited to the
  same user and image, and audit / rate logs.

Not verified here (needs your Supabase project): Supabase Auth e-mail flows, real model
output quality, pg_cron scheduling, and RevenueCat billing webhooks.
