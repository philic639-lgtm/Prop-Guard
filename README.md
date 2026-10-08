# Prop Guard

**PLAN YOUR TRADE.**

The risk-management, planning, education and strategy-improvement companion for prop firm traders.

Prop Guard is an iOS-first (Android-compatible) discipline engine for futures traders: ES, MES, NQ and MNQ, often on prop-firm accounts. It sits beside the trader before, during and after every session. It sizes risk, enforces daily limits and cooldowns, checks each setup against the trader's **own** strategy, and journals everything into a Discipline Score.

> Prop Guard is a risk-management and journaling tool. It does not provide financial advice or guarantee trading results. Users are responsible for their trading decisions.

The AI never predicts the market. It checks whether **you** are following **your** trading system.

---

## Quick start (Demo Mode, no keys needed)

```bash
npm install
npm start          # Expo dev server. Press i (iOS simulator), a (Android) or w (web)
```

Without Supabase credentials the app starts in **Demo Mode**. On the welcome screen tap **Explore the demo** to load a realistic 25K prop account, two strategies, about a month of trades, journal entries and discipline events. Tap **Get started** to run the onboarding (Beginner: 5 steps → learning path; Experienced: 6 steps → quick start) with your own numbers, stored on the device.

Requirements: Node 20+ and the Expo Go app (SDK 57) or an iOS/Android simulator.

### What you can click through

| Area | Screens |
| --- | --- |
| Onboarding | Welcome (“PLAN YOUR TRADE.”) → instruments → **experience** (Beginner / Experienced) → [experienced: choose path — I have a strategy / Help me build] → account (firm → program → stage → size loads **verified** rules; unverified firms stay blank, nothing assumed) & risk limits → trading preferences → rules → Beginner: `/learn` · Experienced: strategy import/builder or `/start` |
| Learn (beginner) | `/learn` hub with saved progress · 8 modules / 15 short lessons (prop firms, drawdown, daily loss, payouts & consistency, risk per trade, personality, strategy discovery, chart patterns/entries/stops, honest practice, plan, journal & review) · interactive examples on the real engines (drawdown simulator incl. a verified LucidPro 50K preset, daily-loss, position sizer, R:R, consistency) · quizzes · skip / revisit · `/learn/personality` · `/learn/strategies` (Strategy Finder matcher) · `/learn/plan` (rules + sizing + account limits + checklist + routine → saved strategy → Practice) |
| Quick start (experienced) | `/start`: setup checklist from real data (verified account, risk manager, strategy, practice, journal, insights threshold) + tool grid. Switch Beginner ↔ Experienced any time in Profile; no data is lost |
| Strategy | Describe in plain English → AI converts to measurable rules → review/edit/add/delete → practice or use · Help-me-build generator · Library (15M ORB Retest, VWAP Pullback, Breakout + Retest, Key Level Rejection, …) · Finder |
| Home | Account progress, balance, daily P&L, risk/trades/drawdown remaining, consistency, trading plan, Check Trade / Analyze Setup, insight, recent trades |
| Analyze (center tab) | Manual Entry / From Chart → AI entry analysis (GOOD ENTRY / CAUTION / RULE VIOLATION, per-condition ✓ ⚠ ✗, trade details, suggested adjustment) → Save Trade Plan or enter → Live Trade Monitor (chart, demo price feed, alerts) → loss cooldown |
| Journal | Calendar + filters, journal a trade (screenshot or manual: emotion, followed plan, notes), entry detail with strategy-followed badge and AI notes |
| Performance | Net R/P&L, win rate, trades, avg R, equity curve, **results by conditions met (7/7 vs 6/7 vs ≤5/7)**, insight, advanced breakdowns |
| More | AI Session Summary (Today / Weekly / Insights, revenge/overtrading flags), Practice Mode, Alerts feed, Risk & Position calculator, Discipline, Accounts, Paywall (Free vs Pro), Profile (gear icon on Home) |

**Demo / mock data while backends are not configured:** demo account, trades, plans, practice history and alerts; on-device AI provider (rule-based parsing, reviews, coaching; screenshot reads return a clearly-labelled sample in Demo Mode and always require confirmation); simulated live price feed on the Live Trade Monitor; development billing (toggle Free/Pro on the paywall). Broker connections are UI placeholders marked *Coming soon*.

### Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start Expo |
| `npm run ios` / `android` / `web` | Start on a specific platform |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (expo config) |
| `npm test` | Jest unit tests for all engines, demo data, mappers and AI matching |
| `npm run check` | All of the above |

---

## Environment variables

Copy `.env.example` to `.env`. **Only `EXPO_PUBLIC_*` values are bundled into the app, so never put secrets in them.**

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL. Blank means Demo Mode |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (safe for clients; RLS protects data) |
| `EXPO_PUBLIC_AI_MODE` | `mock` (default, on-device) or `remote` (Supabase Edge Function) |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` | RevenueCat **public** SDK keys (optional) |
| `EXPO_PUBLIC_DEV_UNLOCK_PRO` | Unlock Pro while developing (default `true` when RevenueCat is not configured) |

Never ship the Supabase service-role key, AI provider keys or RevenueCat secret keys in the app.

---

## Connecting Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema (tables, indexes, triggers, RLS policies and the private `screenshots` bucket):
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push        # applies supabase/migrations/*
   ```
   Or paste `supabase/migrations/20261003000000_init.sql` into the SQL editor.
3. Put the URL and anon key in `.env`, then restart Expo.
4. Sign up in the app. A trigger creates `profiles`, `user_preferences` and `subscription_status` rows for each new user.

**Data model:** `profiles`, `user_preferences` (including personal trading rules), `accounts`, `prop_rules`, `strategies`, `strategy_rules`, `sessions`, `trades`, `trade_checklists`, `journal_entries`, `screenshots`, `discipline_events`, `notifications`, `subscription_status` and `ai_analysis`. Every table has `user_id` and Row Level Security, so users can only read or write their own rows. `subscription_status` is read-only for clients; only the service role (a billing webhook) writes it.

**Sync model:** offline-first. The on-device Zustand store is the UI's source of truth. When a user is signed in, every change is queued and written through to Supabase in order (`src/services/syncService.ts`). Failed writes stay queued and are retried when the app returns to the foreground. On sign-in the last 1,000 trades are loaded, and older history can be paged with `SupabaseRepository.fetchTradesBefore`.

---

## Configuring AI

The app is fully usable without any AI key. `MockAIProvider` produces rule-based reviews from the deterministic engines.

To enable a real model, use the `ai-gateway` Edge Function. Keys stay server-side:

```bash
npx supabase functions deploy ai-gateway
npx supabase secrets set AI_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-...   # or
npx supabase secrets set AI_PROVIDER=openai OPENAI_API_KEY=sk-...
# optional: ANTHROPIC_MODEL / OPENAI_MODEL
```

Then set `EXPO_PUBLIC_AI_MODE=remote`.

### Setup Check (chart vs your saved rules)

`Analyze Setup` (Home) / `AI Setup Check` (Check Trade) checks a setup against the selected strategy's **own** saved rules with one deterministic engine, `evaluateSetup` (`src/lib/engines/setupCheck`). The same code runs on the server: `npm run shared:sync` copies it (plus the instrument catalog) to `supabase/functions/_shared/setupCheck` — run it after editing the engine; a test fails if the copies drift.

- Rule alignment = confirmed required rules ÷ required rules. Missing, low-confidence, unverified or demo evidence adds zero. It measures rule completion, not win probability; there is no grade.
- 🟢 QUALIFIED (engine `TAKE TRADE`) only when every required rule, risk check and prop check passes; a critical failure or a known risk / firm violation → 🔴 STAND DOWN; anything else → 🟡 WAIT.
- Changing the screenshot, strategy, instrument, account, direction, entry, stop, target or size invalidates the previous analysis; late responses never overwrite newer ones.

Modes:

| Mode | When | Who decides | Chart analysis |
| --- | --- | --- | --- |
| REMOTE | signed in (cloud), `EXPO_PUBLIC_AI_MODE=remote`, function deployed | `setup-validation` Edge Function (loads strategy, account, prop rules, trades for the user) | OpenAI Responses API, image bytes + strict JSON schema |
| MANUAL | no provider configured | device | none — every rule is confirmed by the trader |
| DEMO | "Explore the demo" | device | simulated, labelled, zero weight — can never clear |

**One decision, exact reasons.** Every check ends in one status — 🟢 QUALIFIED, 🟡 WAIT (setup forming — or "needs your input" when something can't be verified), 🔴 STAND DOWN (no clear match to your saved setup) or 🔒 BLOCKED (setup may be valid, but a hard risk or prop-firm rule fails, with the exact numbers). It shows a setup-match % built from your own saved rules (weights by condition type; never a win probability and never enough on its own), the strategy / ICC stage, a checklist, entry / invalidation / stop / TP1 / TP2 with risk, reward, R:R, risk per contract and the max contracts that fit, prop-firm rows (PASS / FAIL / UNVERIFIED — live balance / P&L is not connected, so daily loss and drawdown stay UNVERIFIED until you confirm them), and a collapsible "Why this decision?". **Save to Journal** stores the full analysis: QUALIFIED also creates a pending journal trade; WAIT / STAND DOWN / BLOCKED are saved as setup reviews, not trades. The same engine emits lifecycle events (`setupTransition`) for future setup alerts.

**ICC — Indication / Correction / Continuation.** Choose the ICC template in the Strategy Library (Save Strategy), then pick it in Setup Check. Its stage rules come first (higher-timeframe alignment, indication, correction, continuation, structure intact, direction match, structural stop, stage quality ≥ 70 / ≥ 60), on top of your own added rules, risk plan and prop-firm rules. The ICC card shows the entry status (`WAIT — INDICATION ONLY` … `VALID ICC LONG/SHORT`, `ICC SETUP INVALIDATED`, `NO CLEAR ICC SETUP`, or `VALID SETUP — POSITION SIZE TOO LARGE / STOP DISTANCE EXCEEDS RISK LIMIT`), a 0–100 stage-quality score, entry / stop / TP1 / TP2 with R:R, what has happened / is developing / still needs to happen, and an overlay on the screenshot when the chart reading supplies positions. The final decision is still the engine's QUALIFIED / WAIT / STAND DOWN.

```bash
npm run shared:sync                                    # after engine edits
npx supabase db push                                   # setup_checks + setup_validation_requests columns
npx supabase functions deploy setup-validation
npx supabase secrets set OPENAI_API_KEY=sk-...           # server-side only
# optional: OPENAI_VISION_MODEL (default gpt-6-sol), SETUP_CHECK_RATE_PER_HOUR (30), SETUP_CHECK_TIMEOUT_MS (30000)
```

Safety design:
- **Provider-independent.** Screens call `aiService` (`src/services/ai`), which implements `AIProvider`: `analyzeTradeSetup`, `analyzeScreenshot`, `generateSessionReview`, `recommendStrategies` and `generateDailyCoach`.
- **The grade is never AI-generated.** `strategyEngine.evaluateSetup` decides A+ / Valid / Caution / Rule Violation / No Trade deterministically. The model only explains the result.
- **Minimized payloads.** No names, emails, account names or balances are sent.
- **Typed, validated output.** Every response is validated with Zod. Invalid responses fall back to the local provider.
- **Hard rail.** When Daily Guard says STOP, the coach message is never model-generated.
- **Screenshot values must be confirmed by the user** before anything is calculated.

---

## Prop firm rules (automated account setup)

New account → **Firm** (autocomplete) → **Program** (e.g. LucidPro) → **Stage** (Evaluation / Funded (simulated) / Live) → **Account size** → **purchase options** (e.g. Lucid "Daily Loss Limit On / Off") → **purchase date** → the verified rules load automatically, read-only, with their official source and last-verified date. "Override firm rules" unlocks them when your agreement differs (tracked as overrides). Rules a firm doesn't state stay editable; nothing is guessed, zeroed or copied from another program. Saving is blocked if the size, options or loaded rules don't match the selected configuration.

Verified coverage today: **Topstep** (Trading Combine, Express Funded, Live Funded — 50K/100K/150K) and **Lucid Trading** (LucidPro and LucidFlex, evaluation + funded, 25K/50K/100K/150K, with the DLL On/Off option and dated legacy terms). Other firms in the directory (Apex Trader Funding, Take Profit Trader, MyFundedFutures, TradeDay, Earn2Trade, Tradeify, Bulenox, Elite Trader Funding, TickTickTrader) have **no programs on file yet** — their rules are entered manually.

Loaded rules drive the account dashboard and Setup Check: EOD / intraday / static drawdown with firm lock points (e.g. start + $100), percentage drawdowns, fixed / scaling / "none" daily loss limits (soft or hard breach), consistency and typed payout requirements — all labelled as based on your entered balance and journal, never live broker data.

Maintenance (server-only, low cost):

```bash
npm run firm-rules:sources                         # the official pages the monitor watches
npx supabase db push                               # monitor tables + program options
npx supabase functions deploy firm-rules-monitor --no-verify-jwt
npx supabase secrets set FIRM_RULES_MONITOR_SECRET=<random>
# schedule weekly with pg_cron + pg_net (SQL in supabase/migrations/20261017000000_firm_rules_automation.sql)
```

The monitor checks at most 25 due pages per run with conditional requests and a content hash (no AI, no per-visit scraping). A changed page opens a review in `prop_firm_rule_reviews`; a person re-verifies, edits the rules JSON (`firm-rules:export`) and publishes a new version (`firm-rules:publish`) — previous versions are kept for accounts bought under older terms. Blocked or unreachable pages back off (7 → 14 → 28 → 30 days) and keep the verified data.

## Account screenshot import

Accounts → New / an account's page / onboarding → **Import account screenshot**: upload (several at once), take a photo, drag & drop or paste (desktop). Prop Guard reads the dashboard, matches firm → program → size → stage, and shows every value for review — low-confidence values highlighted, missing ones "Not detected", screenshot conflicts as choices. Nothing is saved until the trader confirms; then the balance and drawdown tracking update, the account shows **Screenshot updated · date** (not "connected") and a dated history is kept.

| | |
| --- | --- |
| Extraction | `src/lib/engines/accountImport` (pure, tested on real OCR output of 5 dashboard layouts) |
| OCR (web) | [tesseract.js](https://github.com/naptha/tesseract.js) in the browser — free, no API key, the image never leaves the device. Engine + English model (~4 MB) load on first use from jsDelivr, or self-host: `npm run ocr:assets` then build with `EXPO_PUBLIC_OCR_ASSETS_URL=/ocr` |
| OCR (iOS/Android) | Not bundled yet (needs a native text-recognition module in a development build). Native users can use the advanced reader, if configured, or enter values manually on the same review screen |
| Advanced reader (optional) | `ai-gateway` task `account_screenshot_v2` (your Anthropic/OpenAI key, server-side). Runs only when the trader taps it for a hard screenshot; account numbers are blacked out first; the image is not stored |
| Database | `accounts.import_state` (migration `20261019000000`): confirmed values + history + one-way account fingerprint (duplicate prevention). No screenshots, no raw account numbers |

Demo Mode includes **synthetic** sample dashboards (Lucid-style, Topstep-style, generic, blurry) that run through the real OCR.

## RevenueCat (later)

Billing is abstracted in `src/services/subscriptionService.ts`, and plans and entitlements are configured in `src/config/plans.ts`. Business logic checks **features**, never prices. Until RevenueCat is configured, a development provider is used, and the paywall lets you preview the Free and Pro tiers.

To go live:
1. `npx expo install react-native-purchases`. This needs a development build, not Expo Go.
2. Add the public SDK keys to `.env`.
3. Implement `BillingProvider` with `Purchases.configure`, `getOfferings`, `purchasePackage` and `restorePurchases`, using entitlement id `pro`.
4. Add a RevenueCat webhook (an Edge Function with the service role) that writes `subscription_status`.

| Free | Prop Guard Pro |
| --- | --- |
| Risk calculator, Daily Guard, 1 account, journal (latest 50 trades), 3 templates, 1 custom strategy | AI Trade Checker, AI Strategy Finder, screenshot analysis, unlimited accounts, advanced analytics, Discipline Score, AI Coach, notifications, unlimited journal, custom strategies |

---

## Architecture

```
src/
  app/                 Expo Router routes (screens only)
    (tabs)/            Home · Session · Strategy · Journal · Profile (custom tab bar)
    onboarding/        Dual onboarding (beginner / experienced)
    learn/             Beginner learning path: hub, lesson player, personality, strategy matches, plan
    start              Experienced quick start
    auth/              Email sign-in / sign-up (Apple & Google structured, coming soon)
    session/           check · live · loss (anti-revenge) · review · screenshot
    strategy/          builder [id] · library · finder
    journal/[id]       trade detail + journaling
    accounts/          prop account tracker + rule evaluation
    analytics, discipline, calculator, paywall, notifications, settings/*
  components/ui/       Design system: AppText, Card, Button, Input/NumericInput, SegmentedControl,
                       StatusBadge, RiskProgress, CircularScore, RuleChecklist, Sheets, EmptyState…
  components/charts/   SVG LineChart, BarChart, ChartCard (react-native-svg, no native chart deps)
  components/domain/   TradeCard, StrategyCard, AccountSelector, DailyGuardCard, ProGate, TabBar…
  features/            Feature-scoped logic & components (session, strategy, journal, accounts, onboarding…)
  lib/engines/         Pure, tested domain engines
  services/            ai/, supabase/, syncService, authService, screenshotService,
                       notificationService, subscriptionService
  store/               Zustand stores (persisted app store, subscription store)
  data/                Demo data generator + educational strategy library
  config/ constants/ types/ utils/ hooks/
supabase/
  migrations/          Schema + RLS + storage policies
  functions/ai-gateway Provider-switchable AI proxy (Deno)
  functions/setup-validation  Chart vs saved rules (OpenAI Responses API, strict schema, rate limit)
```

### Core engines (`src/lib/engines`)

| Engine | Responsibility |
| --- | --- |
| `instrumentEngine` | **Only** place for tick size, tick value, point value and micro/mini links (ES $50/pt, MES $5, NQ $20, MNQ $2) |
| `riskEngine` | Risk/reward dollars, R:R, ticks, account %, position sizing, stop-change deltas |
| `dailyGuardEngine` | SAFE / CAUTION / STOP from daily limit, trades, consecutive losses, cooldown, drawdown buffer |
| `propRuleEngine` | Firm-agnostic rules: daily loss, static / trailing / EOD-trailing drawdown, target, consistency, min/max days, payout, max contracts, custom |
| `strategyEngine` | Deterministic setup grading against the trader's strategy and rules |
| `disciplineEngine` | 0–100 adherence score (not P/L-based), components and timeline from discipline events |
| `analyticsEngine` | Win rate, profit factor, avg R, equity curve, P/L by day, hour, strategy and instrument, compliance split |
| `sessionEngine` | Session summary and local review (including cooldown-gap detection) |
| `learningEngine` | Lesson progress (never downgrades completed), quiz grading, deterministic trading-personality profile (rules from the trader's own limits, only ever tightened to the account), strategy recommendations via the Strategy Finder, trading plan (risk-engine sizing + account limits), experienced quick-start checklist |

Discipline events: `RULE_FOLLOWED`, `RULE_OVERRIDDEN`, `STOP_WIDENED`, `DAILY_LIMIT_HIT`, `TRADE_LIMIT_HIT`, `COOLDOWN_BROKEN`, `STRATEGY_VIOLATION`, `JOURNAL_COMPLETED`.

### Broker connections

V1 supports **Manual** and **Screenshot** modes. Connected Broker mode (Tradovate, NinjaTrader, ProjectX, Rithmic-compatible) appears as *Coming soon*. The trade model, sessions and Daily Guard are already source-agnostic (`Trade.source`), so a future broker adapter only has to produce `Trade` records and mark prices.

### Notifications

`notificationService` uses local Expo Notifications for the pre-session reminder (15 minutes before the strategy window on weekdays), the 75% risk-budget warning, the trade-limit warning, cooldown complete, and the journal reminder 30 minutes after a session ends. Each can be toggled under Profile → Notifications.

---

## Building for the App Store

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios
```

The bundle identifier is `com.propguard.app` (`app.json`). Photo and camera usage strings are already configured.
