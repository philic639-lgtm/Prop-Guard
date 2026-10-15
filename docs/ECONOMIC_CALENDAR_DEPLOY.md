# Economic calendar — deployment (project `iohemtxcumpckqhboqts`)

Prop Guard Intelligence reads five free official sources on the server, stores them in
Supabase, and the app reads the stored copy. Nothing paid, no API keys, no AI.

| Feed id | Source | What is stored |
|---|---|---|
| `bls` | https://www.bls.gov/schedule/news_release/bls.ics | Scheduled BLS releases (date + published time) |
| `bea` | https://www.bea.gov/news/schedule | Scheduled BEA releases (date; time only when the page states Eastern time or `ECON_BEA_TIMES_EASTERN=true`) |
| `fed` | https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm | FOMC statement / press-conference dates (2:00 / 2:30 PM ET shown as "usual time — confirm") |
| `bls_updates` | https://www.bls.gov/feed/bls_latest.rss | Release notices: title, link, publication time |
| `fed_updates` | https://www.federalreserve.gov/feeds/press_monetary.xml | Monetary-policy press releases: title, link, publication time |

No forecasts, actual results or firm trading restrictions are stored. Impact ratings
(high / medium / low) are Prop Guard's own classification (`IMPACT_RULES`).

## What exists in the project today (checked 2026-10-15)

- `economic_events`, `economic_feed_status`: exist (migration `20261025000000`), empty.
- `economic_updates`: **missing** — migration `20261027000000_economic_updates.sql` not applied.
- Edge Function `economic-calendar-sync`: **not deployed** (HTTP 404).
- Scheduled job: none (no data has ever been written).

## Steps

Run these from your own machine (they need your Supabase login; nothing here goes into the app).

1. **Apply the new migration**

   ```bash
   npx supabase link --project-ref iohemtxcumpckqhboqts
   npx supabase db push        # applies 20261027000000_economic_updates.sql
   ```
   (Or paste the file into the SQL editor.)

2. **Deploy the function**

   ```bash
   npm run shared:sync
   npx supabase functions deploy economic-calendar-sync --no-verify-jwt --project-ref iohemtxcumpckqhboqts
   ```
   `--no-verify-jwt` because the scheduler calls it with its own secret header, not a user token.

3. **Function secrets** (server-side only — never `EXPO_PUBLIC_…`)

   ```bash
   npx supabase secrets set --project-ref iohemtxcumpckqhboqts \
     ECON_SYNC_SECRET="$(openssl rand -hex 32)" \
     ECON_CONTACT="you@example.com"
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function by Supabase.
   Keep the `ECON_SYNC_SECRET` value for step 5 (do not commit it).

   Optional: `ECON_BEA_TIMES_EASTERN=true` once you have confirmed BEA's page lists Eastern
   times; `ECON_FOMC_VERIFIED_TIMES={"2026-12-09":"14:00"}` for statement times you checked.

4. **First run and check each source**

   ```bash
   curl -s -X POST https://iohemtxcumpckqhboqts.supabase.co/functions/v1/economic-calendar-sync \
     -H "x-sync-secret: <ECON_SYNC_SECRET>"
   ```
   The response lists every feed id with `status` (`ok` / `not_modified` / `error`), counts and
   any error. Then in SQL:
   ```sql
   select source, status, last_success_at, error, event_count, coverage_until from economic_feed_status order by source;
   select date_et, time_et, time_status, name, source from economic_events where active and date_et >= current_date order by starts_at nulls last limit 20;
   select feed, published_at, title from economic_updates order by published_at desc limit 10;
   ```
   A source with `status = 'error'` and an error such as "format not recognised" means its page
   layout differs from what the reader expects — the app then shows it as **Unavailable / Stale**,
   never as "no news". Send the error text and it can be adjusted.

5. **Schedule it** (pg_cron + pg_net, every 6 hours; secrets kept in Vault)

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select vault.create_secret('https://iohemtxcumpckqhboqts.supabase.co/functions/v1/economic-calendar-sync', 'econ_sync_url');
   select vault.create_secret('<ECON_SYNC_SECRET>', 'econ_sync_secret');
   select cron.schedule(
     'economic-calendar-sync',
     '23 */6 * * *',
     $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'econ_sync_url'),
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'econ_sync_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000
     );
     $$
   );
   ```
   Check runs: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'economic-calendar-sync') order by start_time desc limit 5;`

## Caching and changed dates

- Server: conditional requests (ETag / Last-Modified) — usually "not modified"; 4 runs a day.
- App: reads the stored calendar at most every 30 minutes (and on pull-to-refresh); keeps the
  last copy on the device and shows its age.
- Ids are `source:family:date`. A release the source moves to another day gets the new id; the
  old future row is set `active = false` (kept, never deleted), and phone alerts move with it.

## Status shown in the app

Per feed, with the last successful update in the trader's time zone:

- **Connected** — last refresh succeeded within 36 hours.
- **Stale** — data exists, but the last refresh failed or is older than 36 hours.
- **Unavailable** — never loaded. The app says releases may be missing and never shows "Clear".

## Alerts

- **In-app** (Home, Check Trade, Setup Check, Intelligence): banner from the stored calendar —
  "Release coming up" (60 min ahead) and "News window" (Prop Guard's window per release). If a
  source is stale / unavailable the banner says the calendar can't be confirmed instead.
- **Phone** (iOS / Android app, not web): local notifications scheduled on the device for the
  next 14 days at the advance warnings the trader picks (5 / 15 / 30 / 60 min, any combination),
  only for releases with a known time. They fire with the app closed. They are re-planned when
  the app opens / refreshes the calendar; a release moved while the app stays closed is
  corrected the next time the app is opened. Requires notification permission and a
  development / store build.
