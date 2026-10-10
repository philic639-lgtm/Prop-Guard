# Prop Guard — V1 Audit Report

**Date:** 2026-10-10 · **Branch:** `claude/ecstatic-clarke-ismxpx` · **Scope:** audit, test, and stabilise the existing V1 build. Nothing was added beyond fixes and tests.
**Release state:** committed locally and **not pushed or deployed**, per the audit instructions. The published web preview is the pre-audit build and does not include these fixes.

Every result below is labelled by how it was established:
- **[unit]** — Jest test in the repo
- **[db]** — run against a real PostgreSQL 16 with all migrations applied (Supabase `auth`/`storage` replaced by minimal local stubs)
- **[browser]** — Playwright driving the production web export
- **[code]** — code review only
- **BLOCKED** — needs a service or credential this environment does not have

---

## 1. Project overview

| | |
|---|---|
| App | Expo SDK 57 / React Native 0.8x / Expo Router (file routes in `src/app`), TypeScript, React Native Web for the browser build |
| State | Zustand. A persisted store (`prop-guard-store`, AsyncStorage / localStorage) is the local source of truth. `syncService` writes through to Supabase when the user is signed in |
| Backend | Supabase: Postgres + RLS (18 migrations), Auth (email), Storage (`screenshots` bucket), Edge Functions `ai-gateway`, `setup-validation`, `firm-rules-monitor` |
| AI | Provider-agnostic `aiService`. `RemoteAIProvider` calls `ai-gateway`, which holds the Anthropic/OpenAI keys server-side. `MockAIProvider` is the deterministic on-device fallback |
| OCR | tesseract.js in the browser for screenshot import (free, on-device). No native OCR module |
| Market data | `MarketDataProvider` interface with Databento (server-only), CSV and mock providers; scenarios are labelled educational / SIMULATED / VERIFIED |
| Domain logic | Pure engines in `src/lib/engines` (risk, prop rules, daily guard, analytics, strategy intelligence, setup check, practice, learning, account import) |
| Tests | Jest (`jest-expo`), 37 suites. No E2E framework in the repo, so browser journeys were driven with Playwright scripts outside the repo |
| Scripts | `npm run check` (tsc + eslint + jest), `npx expo export`, `npx expo-doctor`, data/firm-rules CLIs (server-only) |

**Maturity:** the domain engines are well tested and deterministic. Cloud features (auth, sync, AI gateway, vision, historical data) exist in code and are schema-consistent, but could not be exercised end to end here because no Supabase project or API keys are available. Demo/local mode works fully in the browser.

---

## 2. Feature audit table

| Feature | Implementation status | Tests | Result | Remaining issue |
|---|---|---|---|---|
| Onboarding (beginner / experienced) | Fully implemented | [browser] both paths end to end; [unit] learning engine | **Pass.** Correct step counts (5 / 6), back navigation, completion, persisted after reload (hydration-gated redirect) | Answers given part-way through onboarding are not saved if the browser is refreshed mid-flow (P3). Sign-up/sign-in **BLOCKED** (no Supabase) |
| Prop firm rules | Fully implemented (Topstep, Lucid verified; others manual) | [unit] 40+ firm-rule tests; [browser] Lucid program → size → DLL option → locked verified values | **Pass.** No cross-program leakage; unverified versions not applied; overrides tracked | Only 2 firms have verified rules (by design). The `firm-rules-monitor` job is **BLOCKED** (needs deployed function + secret) |
| Screenshot account import | Fully implemented on web; manual review fallback on native | [unit] 40 extraction/validation tests on real Tesseract output; [browser] upload, drag-drop, multi-screenshot, duplicate, conflict, update, onboarding | **Pass after fixes** (see §3: look-alike values, multi-value ambiguity, file validation, low-confidence gating) | No native (iOS/Android) OCR. Fixtures are synthetic mock-ups, not real firm screenshots. Advanced (vision) reader **BLOCKED** (no AI key) |
| Strategy Builder (strategy analysis) | Fully implemented (deterministic analyzer + optional AI merge) | [unit] 41 strategy-intelligence tests incl. 4 new; probe with ORB / pullback / mean-reversion / order-flow texts | **Pass after fixes.** Four distinct classifications, no invented indicators | Fixed the inverted trading window and garbled entry/stop sentences (§3). The remote AI path is **BLOCKED** (no key); the fallback to local analysis on AI failure is unit-tested |
| AI Setup Check | Fully implemented (REMOTE / MANUAL / DEMO modes) | [unit] 40+ engine/decision/ICC/vision-adapter tests incl. Edge-Function sync check | **Pass** [unit]. Demo evidence never counts; nothing pre-ticked; client cannot inject evidence; provider failure never fabricates | Live vision **BLOCKED** (needs `setup-validation` deployed + OpenAI key). Browser: screen renders without errors (responsive sweep) |
| Risk Manager | Fully implemented | [unit] risk, daily guard, prop-rule tests (+4 new); [browser] journal P&L | **Pass after fix.** Contract specs verified (ES $50, MES $5, NQ $20, MNQ $2 per point) | Fixed: remaining risk ignored the drawdown floor, and the daily limit ignored the program's daily-loss mode (§3). Daily boundaries use the calendar day, not the 6 pm ET futures session (P2, documented) |
| Practice Mode | Implemented; real historical data needs a server-side ingest | [unit] practice trainer / market-data / no-lookahead tests | **Pass** for honesty and separation: simulated data is labelled and excluded from statistics; practice is stored apart from journal trades | Verified historical scenarios **BLOCKED**: require `npm run data:*` with a Databento key (paid vendor, not added). Demo uses educational/SIMULATED scenarios |
| Trading Journal | Manual journal + pending trades from checks; broker auto-import is interface-only | [unit] journal engine + new store tests; [browser] add → balance → delete → balance restored | **Pass after fix** (delete/edit now keep the balance correct) | There is no broker connection, so "automatic journaling" means checked trades become pending entries the trader completes. The broker UI is marked *Coming soon* |
| Analytics | Fully implemented | [unit] analytics tests; [browser] Performance page cross-checked against an independent recomputation (28 trades, 46%, +$867.50, PF 1.37 — exact match) | **Pass** | — |
| Authentication | Email auth implemented; Apple/Google placeholders | [code] review; [db] RLS cross-user tests; [unit] user-switch sync test | RLS **pass** [db]; fixed a cross-user sync leak (§3). Live sign-up/sign-in/session **BLOCKED** (no Supabase project) | Apple/Google sign-in shows "coming soon" |
| Responsive interface | Implemented | [browser] 16 routes × 360, 390, 1280 px | **Pass.** No horizontal overflow, no blank screens, no runtime errors | Desktop shows the mobile layout centred (no desktop-specific layout); acceptable for beta |

---

## 3. Bugs discovered

| # | Severity | Area | File(s) | Root cause | Status |
|---|---|---|---|---|---|
| 1 | **P0** | Sync / privacy | `src/services/syncService.ts`, `src/hooks/useBootstrap.ts` | The offline write queue resolved its user only when replayed. If user A had unsynced writes and user B then signed in (without a clean `SIGNED_OUT`, e.g. after an expired session), A's records were written into **B's cloud account**; RLS allows it because the row gets B's `user_id`. A's local data could also stay on screen for B when B's cloud account was empty. Reproduced by a unit test that fails on the old code | Fixed |
| 2 | **P1** | Risk | `src/lib/engines/dailyGuardEngine.ts` | `riskRemaining` = daily budget − used and ignored the drawdown floor. With $300 left above the floor and $1,000 of daily budget, Home, Check Trade and position sizing reported "$1,000 risk left", overstating what can be lost before failing the account | Fixed |
| 3 | P2 | Risk | `dailyGuardEngine.ts` | The guard read `rules.dailyLossLimit` directly instead of `dailyLossLimitFor`, so verified program modes (scaling DLL, verified "no DLL") disagreed with the account evaluation | Fixed |
| 4 | **P1** | Journal / balance | `src/store/useAppStore.ts` | `deleteTrade` removed a closed trade but not its P&L from the account balance, and `updateTrade` didn't move the balance when a closed trade's P&L changed. Balance, drawdown buffer and risk stayed wrong | Fixed |
| 5 | **P1** | Screenshot import | `src/lib/engines/accountImport/extract.ts` | "Unrealized P&L" / "Open P&L" were read as net P&L; "Profit Target Remaining" could be read as the profit target; "Peak balance" / "High water mark" competed with the balance; with several balances on one screenshot (multi-account lists) one was picked **silently** | Fixed: look-alike labels are now consumed and ignored; several different readings of a field on one page become an ambiguity the trader must resolve |
| 6 | **P1** | Screenshot import | `src/services/accountImport/*`, `DropZone.web.tsx`, `useImportSession.ts` | No file validation: any dropped or pasted file was accepted (PDFs, 16 MB+ files, huge images) | Fixed: type allow-list, 15 MB cap, 40 MP cap, minimum size; corrupt files report "could not be opened" |
| 7 | P1 | Screenshot import | `src/app/accounts/import.tsx` | Low-confidence readings of values that change the account (balance, threshold, remaining, current drawdown) only needed the single global "I checked" toggle | Fixed: each uncertain value now needs its own acknowledgement (or a correction) before saving |
| 8 | **P1** | Strategy Builder | `src/lib/engines/strategyIntelligence/interpret.ts` | "No trades after 11:00" was parsed as a window **starting** at 11:00, the opposite of the trader's rule | Fixed (negations now set the end time) |
| 9 | P2 | Strategy Builder | `interpret.ts` | A bare "I go long" always merged with the next fragment: "If X, I go long; …" lost its condition, and "I go long. Stop 2 ticks…" turned the stop rule into "Go long Stop 2 ticks…" | Fixed |
| 10 | P2 | Backend / cost | `supabase/functions/ai-gateway/index.ts` | No per-user rate limit (cost exposure). Image tasks did not check the declared MIME type or magic bytes. Raw provider error messages were returned to clients. The legacy `account_screenshot` prompt lacked the "untrusted image text" guard | Fixed (60/hour default via `AI_RATE_PER_HOUR`, counted from the audit table; PNG/JPEG/WebP signature check; generic client error) — **not runnable here (no Deno)** |
| 11 | P2 | Database | new migration `20261020000000_ai_audit_kinds.sql` | `ai_analysis.kind` CHECK did not include `strategy_analyze` / `account_screenshot_v2`, so the gateway's audit insert failed silently for those tasks | Fixed; verified [db] |
| 12 | P3 | Onboarding | `useOnboardingStore.ts` | Answers given part-way through onboarding live in a non-persisted store, so a refresh mid-flow restarts it. Completed onboarding is persisted | Documented, not changed |
| 13 | P2 | Risk | `dailyGuardEngine.ts` (`dayKey`) | Today's P&L uses the device's calendar day, not the CME session that starts at 6 pm ET; evening trades count toward the next calendar day | Documented, not changed (needs a product decision on session boundaries) |
| 14 | P3 | Import UX | expo-image-picker (web) | Choosing a PDF through the picker shows the library's own message, "Only images and videos are supported" | Documented |

The audit also found one regression in my own fix, before release: the new file validator rejected the built-in sample screenshots, which have no MIME type. The browser E2E run caught it, and it was fixed: an unknown type is now left to the image decoder.

---

## 4. Fixes completed

| Fix | Files | Why |
|---|---|---|
| Clear the sync queue when a different user attaches; wipe local data before loading a different signed-in user | `syncService.ts`, `useBootstrap.ts`, test `src/services/__tests__/syncUserSwitch.test.ts` | Bug 1: cross-account data leak |
| `riskRemaining = min(daily room, drawdown room)` with open risk counted against both; daily limit taken from `dailyLossLimitFor` | `dailyGuardEngine.ts`, +4 tests in `dailyGuardEngine.test.ts` | Bugs 2–3 |
| Deleting or editing a closed trade adjusts the account balance and syncs the account | `useAppStore.ts`, new `src/store/__tests__/journalBalance.test.ts` (5 tests) | Bug 4 |
| `ignore` label class (unrealized/open P&L, buying power, equity, remaining target, peak balance, win rate, fees, …); per-page multi-value ambiguity; "realized P&L" downgraded to "verify" | `accountImport/extract.ts`, `reconcile.ts`, +15 tests | Bug 5 |
| File validation (`rejectReason`) on every entry path; readable rejection messages | `services/accountImport/validate.ts`, `images.ts`, `DropZone.web.tsx`, `useImportSession.ts`, `import.tsx`, tests | Bug 6 |
| Per-field acknowledgement for uncertain readings that change the account | `app/accounts/import.tsx` | Bug 7 |
| Negated "after TIME" sets the end of the trading window; bare action verbs keep their condition and never absorb the next rule | `strategyIntelligence/interpret.ts`, +4 tests | Bugs 8–9 |
| Gateway: rate limit, image signature check, generic errors, prompt guard; audit-kind migration | `ai-gateway/index.ts`, `20261020000000_ai_audit_kinds.sql` | Bugs 10–11 |

No working feature was removed; no new product modules were added.

---

## 5. Test results

| Command / check | Result |
|---|---|
| `npx tsc --noEmit` | **Pass** (0 errors) — before and after |
| `npx eslint .` | **Pass** (0 errors, 0 warnings) |
| `npx jest` | **Pass — 37 suites, 567 tests** (baseline 34 / 537; +30 new regression tests). 0 failed, 0 skipped |
| `npx expo-doctor` | 19/21 pass; 2 **BLOCKED** (schema check and React Native Directory check need network access to exp.host) |
| `npx expo export --platform web` | **Pass** (production web bundle) |
| Migrations on PostgreSQL 16 [db] | **Pass** — all 18 apply in order |
| RLS cross-user test [db] | **Pass** — A cannot read, update or delete B's account; inserting rows owned by B is rejected (accounts, preferences, storage objects); anon sees no private rows; duplicate import fingerprint per user is rejected, across users it is allowed |
| Client ↔ schema contract [db] | **Pass** — every column written by all 16 mapper targets exists; 285 demo rows (2 accounts, 29 trades, events, plans, pending trades, preferences) insert through the real mappers with all constraints satisfied |
| Browser — beginner journey | **Pass** — onboarding (5 steps, verified Lucid rules, DLL guard) → lessons/quiz/skip → personality → matches → plan → practice → home card → switch to experienced |
| Browser — experienced journey | **Pass** — 6 steps, unverified firm stays blank (no invented limits), quick-start checklist |
| Browser — existing user | **Pass** — reload keeps data; "Make active" switches account without accidental navigation; manual MES trade +$22.50 updates the balance; delete restores it exactly; Performance numbers match an independent recomputation |
| Browser — screenshot import | **Pass** — samples, file-picker upload (multiple), drag & drop, duplicate blocked → "update instead", edits re-checked, firm/size mismatch warnings, blurry warning, onboarding import; PDF, corrupt PNG and 16 MB files rejected with messages |
| Browser — responsive | **Pass** — 16 routes × 360/390/1280 px: no horizontal overflow, no blank screens, 0 runtime errors |
| Edge functions (Deno) | **BLOCKED** — Deno not installed; `ai-gateway` changes are code-reviewed only |
| Supabase Auth sign-up / sign-in / session refresh | **BLOCKED** — no Supabase project or credentials |
| AI providers (strategy AI merge, setup vision, advanced import reader) | **BLOCKED** — no API keys. The fallbacks are unit-tested; mocked calls are not counted as proof of a live integration |
| Historical market data ingest | **BLOCKED** — needs a Databento key (paid vendor; none added) |

---

## 6. Screenshot import verification

| Question | Answer | Evidence |
|---|---|---|
| Upload works | **Yes (web)** — picker (multiple), camera on mobile browsers, drag & drop, paste | [browser] |
| Image extraction works | **Yes (web)**, via tesseract.js in the browser (0.6–2 s for two screenshots after the first load). **No on-device OCR on iOS/Android**: native users get the same review screen to type values | [browser], [code] |
| Extracted numbers accurate on fixtures | **Yes** on the Lucid-style card grid, Lucid-style details table, Topstep-style table, generic layout, a cropped screenshot, dark and light themes, and 12 synthetic label/format cases (negatives in `-$` and `( )`, commas, decimals, percentages ignored, obscured digits left undetected). Blurry/low-resolution images detect nothing and show "hard to read" | [unit] on real Tesseract output |
| Balance vs drawdown kept distinct | **Yes** — balance, starting balance, max drawdown (amount), threshold (level), current drawdown, remaining, daily vs lifetime P&L, target vs remaining target, buying power/equity vs balance; percentages never read as dollars | [unit] |
| Uncertain fields flagged | **Yes** — highlighted per field; different readings shown as choices; uncertain values that change the account must each be acknowledged or corrected | [unit], [browser] |
| User confirmation required | **Yes** — nothing is saved without "I checked these values", every blocking check acknowledged, and duplicates resolved | [browser] |
| Data saves successfully | **Yes** — new account (form prefill + verified program rules) and existing account update; dated history kept; cloud column `import_state` verified [db] | [browser], [db] |
| Dashboard updates | **Yes** — balance, high-water mark so the program's floor equals the firm's threshold ($49,340 → $1,900.50 remaining), "Screenshot updated · date", home label, risk remaining | [browser] |
| Imported data private | **Yes** — screenshots are not uploaded or stored; account numbers/emails are masked, never stored raw (one-way fingerprint only); evidence text redacted; `accounts.import_state` protected by RLS [db]. The optional advanced reader sends a redacted copy only on explicit request | [unit], [db], [code] |
| Image text cannot steer AI | OCR text is never sent to an AI. The vision prompts state image text is untrusted, and replies are schema-validated, then re-checked by the same engine | [code] |

---

## 7. External service limitations

- **Supabase** (Auth, Postgres, Storage, Edge Functions): no project in this environment. RLS and migrations were verified on local Postgres with stubbed `auth`/`storage`, not on Supabase itself. Supabase is free-tier capable; costs grow with storage and function invocations.
- **AI providers** (Anthropic/OpenAI via `ai-gateway`; OpenAI for `setup-validation`): no keys. **This is a usage-based cost.** The gateway now has a per-user hourly cap (`AI_RATE_PER_HOUR`, default 60); `setup-validation` already had one.
- **Databento** (historical data): server-only, usage-billed; not used here. Without it, Practice uses labelled educational/SIMULATED scenarios.
- **OCR assets:** load from the free jsDelivr CDN by default, or self-hosted (`npm run ocr:assets`). No cost.
- **RevenueCat:** not configured; development billing only.
- **Broker connections** (Tradovate, NinjaTrader, Rithmic, ProjectX): not implemented, and marked *Coming soon* in the UI.

---

## 8. Remaining release blockers

**P0/P1 — unresolved**
1. **Live cloud stack is unverified** (sign-up, sign-in, session refresh, sync round-trip, edge functions with real keys). This must be done once against the beta Supabase project before inviting users. Code, schema and RLS are verified locally, but a hosted run has never happened.
2. **Screenshot import on native (iOS/Android) has no OCR.** Beta testers on the native app get manual entry only. This is acceptable for a web-first beta; otherwise it is a blocker for the native beta.

**Lower priority (not blockers)**
- Futures session boundary (6 pm ET) for daily P&L (P2)
- Mid-onboarding answers lost on refresh (P3)
- Synthetic-only OCR fixtures: run real dashboard screenshots (redacted) from beta users through the importer (P2)
- Picker message wording for non-images (P3)
- `ai-gateway` changes not executed (no Deno); deploy to staging and smoke-test first (P2)

---

## 9. V1 beta readiness

**NEARLY READY — SPECIFIC BLOCKERS REMAIN**

**Evidence:**
- Every core feature passes its local, deterministic checks (567 unit tests; real-Postgres migration, RLS and schema-contract checks; browser journeys for beginner, experienced and existing users, plus screenshot import and responsive layouts).
- The two financial-accuracy defects and the cross-account sync leak found in this audit are fixed and covered by regression tests.

**What remains:** the hosted pieces (Supabase Auth/sync, edge functions, AI and data providers) have never run end to end. A controlled beta is reasonable as soon as one staging pass of those flows succeeds.

---

## 10. Recommended next development action

**Run one end-to-end staging pass on a real Supabase project.**
1. Apply the 18 migrations and deploy `ai-gateway` / `setup-validation` with keys.
2. Sign up two test users, then on one shared browser: sign in as A → create data → go offline → sign in as B. Confirm B sees none of A's data.
3. Run the screenshot import, Setup Check and strategy analysis once each with real providers.
4. Record the results in this report.
