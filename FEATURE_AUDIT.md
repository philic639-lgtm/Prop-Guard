# Prop Guard — Feature Implementation Audit

Audit date: 2026-10-18 · Branch `claude/ecstatic-clarke-ismxpx` · Supabase project `iohemtxcumpckqhboqts` · Vercel project `propguard` (team `prop-guard2`)

## Status key

| Status | Meaning |
|---|---|
| **VERIFIED WORKING** | Real code path, exercised by passing automated tests with real data shapes, and (where noted) a real runtime action. |
| **PARTIAL** | Real implementation with a documented gap, or verified only in tests and not yet in a deployed runtime. |
| **MOCK/DEMO** | Works only with simulated, sample or development data. Labelled as such in the app. |
| **MISSING** | Not implemented. |
| **BLOCKED** | Code exists, but it cannot run or be verified without something outside the repository (a deployment, a secret, a network permission). |

These were **not** counted as working: placeholder data, hard-coded success states, visual-only screens, and simulated AI responses.

## Evidence sources used

- **Code inspection** of every engine, service, store and screen named below.
- **Unit and engine tests.** `npm run check` (typecheck, lint, Jest): 62 suites, 914 passed, 7 skipped. The 7 skipped tests are the opt-in Postgres suite.
- **Database integration tests.** `npm run test:db` (new). It creates a throwaway Postgres 16 cluster, loads a minimal Supabase stand-in (`supabase/tests/supabase-basics.sql`: roles, `auth.uid()`, a storage schema), applies **all 25 migrations**, and runs `supabaseSchema.integration.test.ts` as real `authenticated` and `anon` roles with JWT claims. Result: **7 of 7 passed**.
- **Production build.** `npm run build:web` → `dist/` (entry bundle 5.5 MB plus OCR assets). The built site was served locally with an SPA fallback and opened in headless Chromium at 390×844. `/`, `/intelligence` and `/accounts` rendered with **0 page errors**.
- **Live Supabase (publishable key only).** The REST read of `economic_feed_status` works. All five official calendar sources report successful syncs. The edge function `economic-calendar-sync` is deployed (401 without its secret).
  - Not deployed (HTTP 404): `setup-validation`, `ai-gateway`, `trade-screenshot`, `firm-rules-monitor`.
- **Things this audit could not reach:**
  - `*.vercel.app` is not reachable from the audit sandbox (network policy).
  - The test login (`PG_TEST_EMAIL`) answers "Invalid login credentials".
  - There is no second test user, and there are no Vercel or Supabase admin tokens.

## Production 404: root cause

Vercel production builds from `main`. `main` contains only `45c23e6 Initial commit` (a README), so production serves nothing and returns 404. All app code is on `claude/ecstatic-clarke-ismxpx`, which has `main` as its ancestor, so a fast-forward is possible.

**Fix:** fast-forward `main` to the audited branch (approved by the owner). The Vercel preview of the branch was reported "Ready" by Vercel's GitHub status. This audit cannot load deployed pages itself, so the production check is listed in the manual checklist at the end.

---

## Feature-by-feature

### 1. Authentication and private user data — **PARTIAL** (live sign-in BLOCKED)

- **Files:**
  - `src/services/supabase/client.ts` (publishable key only)
  - `src/app/auth/*`
  - `src/services/syncService.ts`
  - `src/services/supabase/repository.ts`
- **Tables:** every user table has `user_id` and RLS `auth.uid() = user_id`. The `assert_account_owner` trigger covers trades, screenshots and other account-linked rows. The private `screenshots` storage bucket has a per-user folder policy.
- **Tests:**
  - `supabaseSchema.integration.test.ts` (7/7). Another user sees none of the owner's rows, cannot overwrite them, cannot update or delete them, and cannot attach rows to the owner's account. Storage is limited to the user's own folder. `anon` reads only public reference data. A client cannot grant itself Pro.
  - `syncUserSwitch.test.ts`: switching users on one device does not carry data across.
- **Gap / BLOCKED:** a real sign-in against the hosted project could not be performed. The supplied test credentials are rejected, and no second account exists for a live cross-user check.

### 2. Supabase persistence after logout, refresh and device change — **PARTIAL**

- **Files:**
  - `src/store/useAppStore.ts` (`confirmAccountSaved`, `hydrateFromCloud`)
  - `src/lib/engines/accountSync.ts` (`mergeRemoteAccounts`, `verifyPersisted`)
  - `SaveStatusLine`
- **Tests:**
  - Integration: the full dataset uploads in app order and **reads back identical**. This simulates a new device: accounts, strategies, trades, journal, pending trades, setup checks, copy trade, practice, rules and preferences.
  - `accountSave.test.ts`: saves survive a reload; nothing is reported "synced" before the server read-back; unsynced local saves win and are re-uploaded.
  - `selectedAccountUpdate.test.ts` (new): an update survives a reload.
- **Gap:** not verified against the hosted project with a real login (see 1).

### 3. Manual account creation — **VERIFIED WORKING**

- **Files:**
  - `src/app/accounts/[id].tsx` (form, `new` id)
  - `features/accountImport/createAccount.ts`
  - `accountSync.findLikelyDuplicate`
- **Tests:** `accountSave.test.ts`, `multiAccount.test.ts`, `firmRules.test.ts` (the form loads verified rules only), `learning.test.ts` (onboarding never fills firm limits).
- **Runtime:** the creation flow was exercised in earlier browser E2E runs on local builds.

### 4. Screenshot OCR account importing — **VERIFIED WORKING** (on-device OCR) · advanced AI reader **BLOCKED**

- **Files:**
  - `src/services/accountImport/ocr.web.ts`: tesseract.js, on-device
  - `ocr.ts` and the `webview/*` native bridge
  - `src/lib/engines/accountImport/*`: `extractPage`, `reconcile`, `crossCheck`, `resolveLevels`, `matchImport`
- **Fields extracted when visible:** account size, firm, program, balance, P&L, drawdown floor (threshold), daily-loss limit, profit target, status, account identifier (masked plus fingerprint) and dashboard date.
- **Uncertain or conflicting values:**
  - They become `ambiguous` / "needs review" readings, never `Math.abs` or a guess.
  - A value is taken only next to a known label.
  - Missing values are only *calculated* from two read values (`source: 'derived'`).
- **Tests:** `accountImport.test.ts`, `importAccuracy.test.ts`, `importReview.test.ts`, `lucidFlexImport.test.ts`, `ocrEngine.test.ts`, `nativeOcr*.test.ts`, `accountImportValidate.test.ts`.
- **BLOCKED:** the optional advanced reader (`ai-gateway`, `account_screenshot_v2`) is not deployed (404). The app falls back to on-device OCR.

### 5. Review and confirm before screenshot data is saved — **VERIFIED WORKING**

- **Files:**
  - `ImportReviewCard`
  - `accountImport/review.ts` (`buildReview`)
  - `apply.ts` (`confirmImport` → `applyImport`)
  - `src/app/accounts/import.tsx` (`compareUpdate` preview)
- **Behaviour:**
  - Every essential value is shown with its origin tag before "Confirm & Save Account".
  - Uncertain essentials must be confirmed inline.
  - Nothing is written before confirmation.
- **Tests:**
  - `importReview.test.ts`
  - `accountImport.test.ts` (*apply (after confirmation)*)
  - `v1AuditRepairs.test.ts` (new): a value left out of the confirmation does not change the account; rules stay untouched.

### 6. Updating the correct selected account — **VERIFIED WORKING**

- **Files:**
  - `UpdateAccountSheet`
  - `/accounts/import?autoread=1` (update mode)
  - `bulkImport.ts` (`matchToAccount`, `planBulk`)
  - `accountSync`
- **Behaviour:** updates are saved by id. Wrong-account and different-account-number guards apply, and an older screenshot needs acknowledgement.
- **Tests:**
  - `selectedAccountUpdate.test.ts` (new): with two accounts, updating B changes only B, A is unchanged, and the result is read back and survives a reload.
  - `multiAccount.test.ts`, `accountSync.test.ts`, `accountImport.test.ts` (never matches another account number).

### 7. Organized multi-account dashboard — **VERIFIED WORKING** (repaired)

- **Files:** `src/app/accounts/index.tsx`, `accountOverview.ts` (`accountCard`, filters, Needs Attention).
- **Behaviour:** balances are per card and never combined. Each card shows its own Daily Guard buffer, floor status and freshness.
- **Repair:** "Needs Attention" previously ignored daily loss. It now flags:
  - a reached firm daily-loss limit (critical);
  - a firm daily-loss limit with ≤ 25 % of room left (warning);
  - a Daily Guard STOP (warning);
  - an intraday-trailing floor that needs re-confirmation (info).
  So a breach risk on one account is never hidden by a healthy drawdown.
- **Tests:** `multiAccount.test.ts`, `v1AuditRepairs.test.ts` (firm DLL nearly used is flagged; balances not combined).

### 8. Firm/program-specific rules — **VERIFIED WORKING** (seed data) · monitor **BLOCKED**

- **Files:**
  - `src/data/propFirms/*`
  - `firmRulesEngine.ts` (`importProgramRules`, `validateFirmConfiguration`, `calcAfterOverrides`)
  - `src/services/firmRules`
- **Tables:** `prop_firm_*`.
- **Behaviour:**
  - Only `verification.status: 'verified'` versions with a source URL, `verifiedBy` and `lastVerifiedAt` are applied.
  - Otherwise the app shows "Rules not yet verified — enter manually".
  - The account keeps a snapshot of the rules at save time.
- **Tests:** `firmRules.test.ts`, `firmRulesLucid.test.ts`, `topstepRules.test.ts`.
- **BLOCKED:** the `firm-rules-monitor` function is not deployed. Central updates need `npm run firm-rules:publish` with the service role, which is server-only.

### 9. Static, end-of-day and intraday trailing drawdown — **VERIFIED WORKING** (repaired)

- **Files:**
  - `setupCheck/drawdown.ts` (`resolveFloor`, shared with `_shared`)
  - `propRuleEngine.floorStatus` / `drawdownFloor` / `drawdownBuffer`
  - `dailyGuardEngine`
- **Behaviour:**
  - **Static:** start − allowance.
  - **EOD trailing:** a confirmed threshold rises with later closed gains.
  - **Trailing above start without a confirmed threshold:** `null`, shown as "Needs verification". It is never estimated.
  - **Unconfirmed drawdown type:** never used to calculate.
- **Repair:** an **intraday** trailing floor follows the peak *including open profits*, which Prop Guard cannot see.
  - Before: a confirmed intraday floor was shown as exact, which could overstate the buffer.
  - Now: `FloorResult.minimum = true` (unless the floor already sits at its lock). The reason says "treat it as a minimum". Daily Guard sets `drawdownMinimum` and never shows SAFE. My Accounts and the news alert say so too.
- **Tests:**
  - `propRuleEngine.test.ts`, `dailyGuardEngine.test.ts`, `lucidFlexImport.test.ts`
  - `v1AuditRepairs.test.ts` (new): six floor-method cases, plus Daily Guard CAUTION for an intraday minimum.

### 10. Daily-loss, maximum-loss, consistency and payout rules — **VERIFIED WORKING**

- **Files:** `propRuleEngine.ts`:
  - `dailyLossLimitFor`: fixed / scaling / verified `none`
  - `evaluateAccount`: daily loss proximity and breach, max drawdown, consistency (`consistencyPct`), min trading days, profit target, max contracts, payout threshold, and typed `calc.payout` eligibility (cycle profit goal, profitable days)
- **Tests:** `propRuleEngine.test.ts`, `firmRulesLucid.test.ts`, `topstepRules.test.ts`.

### 11. Pre-trade GREEN/YELLOW/RED risk decision — **VERIFIED WORKING** (repaired)

- **Files:**
  - `strategyEngine.evaluateSetup`: A_PLUS / VALID = green, CAUTION = yellow, RULE_VIOLATION / NO_TRADE = red
  - `features/session/useSetupEvaluation.ts`
  - `session/check.tsx`
- **Repair:** missing limits were silently treated as "no limit".
  - No daily limit passed the daily check.
  - A $0 per-trade limit produced a misleading message.
  - Both now add explicit violations ("No max risk per trade is set…", "No daily loss limit is set…"), so the result is red. Prop Guard never approves a trade when required data is missing.
  - An unknown drawdown floor (`account_drawdown`) and an invalid stop were already red and remain so.
- **Tests:** `strategyEngine.test.ts`, `v1AuditRepairs.test.ts` (new: five missing-data cases).

### 12. Account-specific safe-risk recommendation — **VERIFIED WORKING**

- **Files:**
  - `riskEngine.maxContractsForRisk`
  - `dailyGuardEngine` (room with its source: `LIMIT_SOURCE_LABEL`)
  - `setupCheck/risk.ts` (`riskSummary`)
  - `copyTradeEngine.translateCopyTrade`
- **Behaviour:** sizes come from the selected account's Daily Guard, its per-trade limit and its contract caps. No size is suggested when the floor is unknown.
- **Tests:** `riskEngine.test.ts`, `dailyGuardEngine.test.ts`, `copyTradeEngine.test.ts`, `setupDecision.test.ts`.

### 13. Strategy and setup checklist — **VERIFIED WORKING**

- **Files:**
  - `src/data/strategies/catalog.ts`
  - `strategyLibraryEngine`
  - `strategyIntelligence/*`
  - `setupCheck/rules.ts` (`rulesFromStrategy`)
  - MANUAL mode with explicit per-rule confirmations (nothing pre-ticked)
- **Tests:** `strategyLibrary.test.ts`, `strategyParser.test.ts`, `strategyIntelligence.test.ts`, `strategyResolve.test.ts`, `strategyUniqueness.test.ts`, `setupCheckEngine.test.ts`, `setupDecision.test.ts`.

### 14. Real chart/screenshot setup analysis — **BLOCKED** (labelled correctly)

- **Files:**
  - `setupCheck/vision.ts`, `iccVision.ts` (server-only)
  - `supabase/functions/setup-validation`
  - `useProviderMode`
- **Runtime:** `setup-validation` returns **404** (not deployed), and the `OPENAI_API_KEY` function secret is not set.
- **What the app shows instead:**
  - MANUAL mode: "No chart analysis is configured…". The trader confirms each rule.
  - DEMO mode: "DEMO — chart reading is simulated and never counts". It can never clear a trade.
  - No simulated analysis is presented as real.
- **Required to unblock:** deploy `setup-validation`, set `OPENAI_API_KEY` / `OPENAI_VISION_MODEL` as function secrets, and set `EXPO_PUBLIC_AI_MODE=remote` in Vercel.
- **Same blocker:** journal trade-screenshot reading (`trade-screenshot` function, 404).

### 15. Automatic and manual journaling — **VERIFIED WORKING**

- **Files:**
  - `journalEngine` (pending → `Trade`)
  - `src/app/journal/*`
  - `session/*`
  - `buildJournalSave` (QUALIFIED → trade plan plus pending trade)
  - `BrokerProvider` / `planBrokerImport` (interface only; no broker connected, as required for V1)
- **Tests:** `journalEngine.test.ts`, `journalBalance.test.ts`, `setupCheckJournal.test.ts`, `liveTradeEngine.test.ts`, `sessionEngine.test.ts`.
- **Note:** demo mode seeds labelled demo trades (`data/demo`). A real account uses only saved trades.

### 16. Performance and behavioral analytics — **VERIFIED WORKING**

- **Files:**
  - `analyticsEngine`, `disciplineEngine`
  - `(tabs)/performance.tsx`
  - The analytics read only the store's saved trades (`useAccountTrades`).
- **Tests:** `analyticsEngine.test.ts`, `disciplineEngine.test.ts`.

### 17. Economic calendar with genuine source and server-sync timestamps — **VERIFIED WORKING** (backend) · deployed-Vercel load **PARTIAL**

- **Files:**
  - `lib/engines/economicCalendar/*` (BLS iCal, BEA iCal, Fed FOMC, BLS RSS, Fed press RSS)
  - `supabase/functions/economic-calendar-sync`
  - `src/app/intelligence.tsx`
- **Tables:** `economic_events`, `economic_feed_status`, `economic_updates`.
- **Runtime:**
  - The live REST read works with the publishable key.
  - All five sources sync with `status ok`.
  - The production build renders `/intelligence` with no errors.
- **Timestamps:** "Last refreshed" (the device's last successful fetch), "This device last checked" (every attempt) and the server's last successful official-source sync are shown separately.
- **Tests:** `economicCalendar.test.ts`, `economicFeeds.test.ts`, `economicAlerts.test.ts`.
- **Gap:** the deployed Vercel page could not be opened from the audit sandbox. The on-device "Run connection test" (build `calendar-diagnostics-3`) exists for that check, but no result has been reported back yet.

### 18. Personalized high-impact news and drawdown alerts — **PARTIAL** (was MISSING; in-app repaired)

- **New:** `lib/engines/newsCushion.ts` (`newsCushionAlert`). It combines the scheduled release (state, impact) with the **selected account's** Daily Guard cushion. The cushion line always names its limit: personal stop, firm DLL or drawdown room. It also uses the trader's max risk per trade.
- **Levels:**
  - **danger:** a high-impact release is near and there is less than one full-risk trade left, the floor is unknown, or Daily Guard says STOP.
  - **warning:** the cushion is thin, or a high-impact release is near.
  - **info:** otherwise.
- **Never presented as room:** an unknown floor, a missing per-trade limit, an intraday-minimum floor or a stale snapshot.
- **Where it shows:** the `NewsWatch` banner (Home, Check Trade, Setup Check).
- **Existing alerts:**
  - Daily-loss phone alert at ≥ 75 % (`session/check.tsx`).
  - Release-timing phone notifications (`planEconAlerts`).
- **Tests:** `v1AuditRepairs.test.ts` (five cases), `economicAlerts.test.ts`.
- **Remaining gap:** phone notifications are scheduled hours ahead, so their text contains release timing only. Putting the cushion into a pre-scheduled notification would show a stale number. That needs a server-side push at fire time, which is not built.

### 19. Practice mode, historical replay and backtesting — **MOCK/DEMO** (historical data BLOCKED)

- **Files:**
  - `src/services/marketHistory` (educational and simulated providers)
  - `practiceEngine`, `historicalOutcomeEngine`, `strategyEvaluators`
  - `src/services/market-data` (`DatabentoProvider`, server-only)
  - `ingestHistoricalData`
- **Tables:** `practice_scenarios` (**0 rows** live), `historical_bars`, `historical_data_coverage`, `practice_scenario_candles`.
- **Behaviour:**
  - Every scenario in use is educational or `source.kind = 'simulated'`, `verified = false`, labelled `SIMULATED_DATA_NOTE` / `SAMPLE_DATA_NOTE`.
  - Similar-setup and historical statistics are hidden unless verified data meets the sample minimum.
  - Demo candles are never shown as historical results.
- **Tests:** `practiceTrainer.test.ts`, `historicalMarketData.test.ts`, `marketData.test.ts`, `conditions.test.ts`.
- **Required to unblock:**
  1. A Databento API key in `.env.server` (server-only).
  2. `npm run data:ingest` for the instruments and date ranges.
  3. `npm run data:generate` to write verified scenarios into `practice_scenarios` / `practice_scenario_candles` with the service role.
  4. A schedule to keep coverage current.

### 20. Subscription/paywall behavior — **MOCK/DEMO**

- **Files:** `src/services/subscriptionService.ts`, `src/config/plans.ts`, `src/app/paywall.tsx`.
- **Table:** `subscription_status`. Clients cannot write it; this is verified in the integration test.
- **Behaviour:**
  - No RevenueCat keys are configured, so the development billing provider is active.
  - `EXPO_PUBLIC_DEV_UNLOCK_PRO` defaults **on** when billing is not configured. Pro features are unlocked for everyone, and no purchase is real.
- **Required:** a RevenueCat project, products, `EXPO_PUBLIC_REVENUECAT_*` public SDK keys, `RevenueCatBilling` implemented, a webhook writing `subscription_status` server-side, and `EXPO_PUBLIC_DEV_UNLOCK_PRO=false` in production.

---

## Summary table

| # | Feature | Status |
|---|---|---|
| 1 | Authentication & private data | PARTIAL (RLS verified; live sign-in BLOCKED) |
| 2 | Persistence across logout / refresh / device | PARTIAL (integration-verified; live BLOCKED) |
| 3 | Manual account creation | VERIFIED WORKING |
| 4 | Screenshot OCR import | VERIFIED WORKING (AI reader BLOCKED) |
| 5 | Review & confirm before save | VERIFIED WORKING |
| 6 | Correct selected account update | VERIFIED WORKING |
| 7 | Multi-account dashboard | VERIFIED WORKING (repaired) |
| 8 | Firm/program rules | VERIFIED WORKING (monitor BLOCKED) |
| 9 | Static / EOD / intraday drawdown | VERIFIED WORKING (repaired) |
| 10 | Daily loss / max loss / consistency / payout | VERIFIED WORKING |
| 11 | Pre-trade GREEN/YELLOW/RED | VERIFIED WORKING (repaired) |
| 12 | Account-specific safe risk | VERIFIED WORKING |
| 13 | Strategy & setup checklist | VERIFIED WORKING |
| 14 | Real chart analysis | BLOCKED (functions not deployed; labelled) |
| 15 | Journaling | VERIFIED WORKING |
| 16 | Analytics | VERIFIED WORKING |
| 17 | Economic calendar | VERIFIED WORKING backend / PARTIAL deployed load |
| 18 | Personalized news + drawdown alerts | PARTIAL (in-app built; push text timing-only) |
| 19 | Practice / replay / backtesting | MOCK/DEMO (historical data BLOCKED) |
| 20 | Subscription / paywall | MOCK/DEMO |

"VERIFIED WORKING" here means verified by automated tests and a local production build. Items that depend on the hosted deployment are listed in the manual checklist below.

## Manual test checklist (production)

1. Open the production URL. The welcome screen shows "Plan Your Trade." with no 404. Refresh on `/intelligence`: the page still loads (SPA rewrite).
2. Sign up or sign in. Create a manual prop account, refresh, sign out, sign back in on another browser: the account is there.
3. Sign in as a second user: none of the first user's accounts or trades are visible.
4. Import a dashboard screenshot. Every value appears in the review with its origin, and uncertain values ask for confirmation. Confirm, refresh: only the selected account changed.
5. With two accounts, open My Accounts. Each card has its own balance and buffer, and nothing is summed. Log a loss near the firm DLL on one: it shows in Needs Attention.
6. Set max risk per trade to 0 or remove the daily stop, then run Check Trade: the result is red with "No max risk per trade / No daily loss limit".
7. Use an intraday trailing account with a confirmed threshold: Daily Guard is never "Safe to trade" and asks you to re-confirm the floor.
8. Open Intelligence. Sources show Connected with the server sync time, separate from "Last refreshed" (device). Tap "Run connection test" and record the output.
9. Before a high-impact release, the Home banner shows the release and your account's cushion with its source.
10. Setup Check shows "No chart analysis is configured" (MANUAL) or the DEMO label. It never shows a simulated reading as real.
