This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Prop Guard conventions

- All contract math goes through `src/lib/engines/instrumentEngine.ts` — never hard-code multipliers in screens.
- Contract specs (tick size, tick value, point value, micro/mini links) live in `src/data/instruments.ts`. Add a contract by adding one entry to `DEFS`; users can register custom contracts, stored in `preferences.customInstruments`.
- Prop-firm rules (`src/data/propFirms`, `firmRulesEngine`, `src/services/firmRules`): rules are stored per firm → program → size → stage → rule version (effective date). Only a version with `verification.status: 'verified'`, an official source URL, `verifiedBy` and `lastVerifiedAt` is ever auto-applied; otherwise show "Rules not yet verified — enter manually." Never add unverified firm numbers to the seed. Central updates go through `npm run firm-rules:publish` (server-only, service role) into the `prop_firm_*` tables; the app merges them over the seed. Each rule version carries per-rule `records` (value, status `verified` / `needs_review`, official source URL + title + check date); a structured value is applied only if its record is verified. Each program × size × stage is its own entry (no inheritance; firm data in `src/data/propFirms/firms/<firm>.ts`). Imported values are read-only by default ("Override firm rules" unlocks them) and edits are tracked as overrides on `Account.firmLink`, which also stores a snapshot of the rules at save time — later master updates never rewrite it. Flow: firm → program line (`programLines`) → stage → size → purchase options (`PropFirmProgram.options`; records with `when` apply only to that choice, `structured` sets option-dependent values) → purchase date (picks the rule version, incl. legacy terms). `importProgramRules(program, date, options)` returns `needs_options` until every option is chosen; typed calculations (`trailingLockOffset`, `dailyLossMode` incl. verified `none`, `dailyLossScaling`, `payout`) go to `Account.rules.calc` and are dropped for overridden rules (`calcAfterOverrides`). `validateFirmConfiguration` blocks saving mismatched size / options / rules. Lucid data: `firms/lucid.ts`. Source monitoring: `firmRulesMonitor` (shared with the `firm-rules-monitor` Edge Function) only flags reviews — never publishes.
- Automatic journaling: checked trades become `PendingTrade`s; `journalEngine` turns a pending trade + result into a full journal `Trade`. Broker integrations implement `BrokerProvider` (`src/services/broker`) and feed `planBrokerImport` — never write trades from a broker directly.
- Strategy library: built-in templates live in `src/data/strategies/catalog.ts` (`defineTemplate`); search/filters, finder matching, compare, personal performance and pre-trade status live in `strategyLibraryEngine`. Never attach win rates or backtests to a template unless `isBacktested` is backed by real `performanceData`.
- Practice trainer keeps three data layers separate: strategy knowledge (Strategy Library), market history (`PracticeScenario` via `ScenarioProvider` in `src/services/marketHistory` — educational samples, SIMULATED scenarios, and verified historical scenarios generated server-side), and user performance (`practiceAttempts` / `practiceLessons`, never journal trades). Never show similar-setup or historical statistics unless `source.verified` historical data meets the sample minimum.
- Historical market data: providers implement `MarketDataProvider` (`src/services/market-data`) and return `NormalizedBar`s — Practice Mode never knows which vendor supplied them. `DatabentoProvider` and the Supabase stores are SERVER-ONLY (`npm run data:*`, secrets in `.env.server`); never import them in screens or use `EXPO_PUBLIC_` for their keys. Ingestion always goes through `ingestHistoricalData` (coverage check → fetch only missing ranges → dedupe).
- Setup detection for scenarios, backtests and the live checker shares the evaluators in `src/lib/engines/strategyEvaluators` — they only ever receive bars up to the decision bar (no lookahead). Outcomes come from `historicalOutcomeEngine` using post-decision bars only. Mock/simulated scenarios are `source.kind = 'simulated'`, `verified = false`, and never feed similarity statistics or the edge score.
- Strategy Intelligence (`src/lib/engines/strategyIntelligence`): "Teach Prop Guard your plan" analyses ONLY the trader's text. Never fill unstated values from a template or example (`blankStrategy()` is intentionally empty). Every rule carries provenance (`trader` / `inferred` / `suggested`); suggestions are saved only when accepted or edited. The health score is always computed locally, and generated text must never claim a plan is proven, profitable, safe or high win rate (`UNSUPPORTED_CLAIMS`). Suggestions stay in the trader's own vocabulary (`introducesTools` must be empty) and carry a confidence label A–D — E (historically validated) only from verified data. Each analysis must pass `assessUniqueness` (regenerated in preserve mode otherwise); account-wide protections use `scope: 'account'`. Practice runs the trader's own rules via `testableRulesOf` → `compileRuleSet` (a `StrategyEvaluator`).
- Resolve Missing Rules (`strategyIntelligence/resolve.ts`): `buildRuleItems` lists gaps and subjective phrases with strategy-specific options; a rule enters the plan ONLY through an explicit `RuleResolution` (`source: 'ai_approved' | 'custom'`). Screens use `applyResolutions(analysis)` as the plan (DNA, rules, score, Practice) and keep the original analysis as the baseline. Example values (e.g. chase distances) are choices, never defaults.
- Setup Check (`src/lib/engines/setupCheck` — shared with `supabase/functions/_shared/setupCheck` via `npm run shared:sync`; never edit the `_shared` copies by hand): `evaluateSetup` is the ONLY scoring/decision path. The strategy's own required/critical rules (`rulesFromStrategy`) are the denominator; missing, low-confidence, unverified or demo evidence adds zero; TAKE TRADE (shown as "QUALIFIED") needs every required rule + risk + prop check to pass; a critical failure or known risk/firm violation is STAND DOWN, otherwise WAIT; no grades. Client input passes the trust boundary `parseClientInput` → `buildEngineInput` (manual evidence forced to `manual`, system/vision evidence and verified prop data only from trusted context, point value from the instrument catalog, integer contracts, costs in whole-position dollars). Modes: REMOTE (server loads strategy/account/prop for the signed-in user, runs vision, decides), MANUAL (no provider — device decides from explicit per-rule confirmations, nothing pre-ticked), DEMO (simulated observations, labelled, can never clear). `SetupCheckController` ties evidence to screenshot hash + strategy version + inputs (`analysisKey`) and discards stale responses. The OpenAI key stays in function secrets; `src/lib/engines/setupCheck/vision.ts` is server-only.
- ICC — Indication / Correction / Continuation (`setupCheck/icc.ts`, library id `icc`): selecting the ICC template puts the ICC rules first (`iccRules`; template text they cover is not repeated). The vision model (`iccVision.ts`, server-only, strict schema) or the trader (stage chips) only OBSERVE the stages and levels; `resolveIccStages` counts manual or REAL ≥ 0.8 readings only (demo / low confidence never). Entry status, the 0–100 stage-quality score (20/20/20/25/15, top band hidden while blocked), risk statuses and "what must happen next" are deterministic (`iccSummary`); the decision still comes only from `evaluateSetup`, and a high ICC score never raises risk. Chart-read levels are applied only when the trader taps "Use these levels".
- Setup Check decision (`setupCheck/decision.ts`, `risk.ts`, `events.ts`; all built by `runSetupCheck` on device AND server): `decideSetup` refines — never upgrades — the engine verdict into QUALIFIED / WAIT / STAND_DOWN / BLOCKED (+ internal NEEDS_INPUT, shown as WAIT). QUALIFIED only when `evaluateSetup` says TAKE TRADE; a critical strategy failure / no ICC pattern → STAND_DOWN; a hard risk (max risk, plan contract cap, min R:R) or prop-firm FAIL → BLOCKED. `setupMatch` weights the strategy's own rules by category (`CATEGORY_WEIGHT`) and never overrides a missing mandatory confirmation. Risk numbers come from `riskSummary` (instrument catalog; agrees with `riskEngine`). Prop rows are PASS / FAIL / UNVERIFIED — journal-derived buffers stay UNVERIFIED until the trader confirms their live account state (`liveAccountConfirmed`; a future broker feed sets `AccountRiskState.liveData`). Low-confidence chart readings produce prompts, never values. Lifecycle events for future alerts: `setupTransition` (SETUP_DETECTED … RISK_BLOCKED) — any data source. SAVE TO JOURNAL (`buildJournalSave`): QUALIFIED → `SetupCheck.kind 'trade_plan'` + a pending journal trade (origin `setup_check`); anything else → `'setup_review'` only, never a trade.
- Domain logic lives in pure engines under `src/lib/engines` with tests in `__tests__`. Screens stay thin.
- Setup grades come from `strategyEngine` (deterministic). AI may explain, never decide or encourage rule-breaking.
- Zustand selectors must return stable references; derive collections with `useMemo` (see `src/hooks/useAppData.ts`).
- Run `npm run check` (typecheck + lint + tests) before committing.
