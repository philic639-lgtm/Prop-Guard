# Deploying the Prop Guard web app (Vercel)

Prop Guard is an Expo app; its **web build** is a static single-page app (`app.json` →
`web.output: "single"`) that any static host can serve. This repository is set up for
**Vercel + GitHub**: `vercel.json` (build command, output folder, SPA rewrite, cache
headers) and `npm run build:web` (`scripts/build-web.mjs`).

> Until now the app was only previewed as a private Claude Artifact. That viewer is a
> sandboxed preview, not a website — it does not support every mobile browser (iPhone
> Safari shows "This browser isn't supported"). A Vercel deployment gives a normal
> public URL that works in iPhone Safari, Android Chrome and desktop browsers.

## What the build does

```bash
npm run build:web          # = node scripts/build-web.mjs
```

1. Copies the free on-device OCR engine (tesseract.js worker, WASM core, English model,
   ~10 MB) into `public/ocr/` — screenshot import reads images in the browser, nothing is
   uploaded.
2. Runs `expo export --platform web --output-dir dist` with
   `EXPO_PUBLIC_OCR_ASSETS_URL=/ocr`, so the OCR files are served by your own site (no
   third-party CDN), and `EXPO_PUBLIC_OCR_RESTRICTED_HOST=true`, so the OCR model is
   fetched as `eng.traineddata.wasm` — robust on hosts that add `Content-Encoding` to
   `.gz` files.

Output: `dist/` (~23 MB, of which ~15 MB OCR files that load only when a screenshot is read).

## One-time setup

### 1. Accounts and permissions you need
- A **GitHub** account with access to `philic639-lgtm/Prop-Guard`.
- A **Vercel** account (free Hobby plan is enough to start). Sign in with GitHub.
- When Vercel asks, **install the Vercel GitHub App** and give it access to the
  `Prop-Guard` repository (you can grant only this one repository). Vercel needs read
  access to the code and permission to post deployment statuses on commits/PRs.
- Optional, for sign-in and cloud sync: your **Supabase** project's URL and anon key
  (Project Settings → API). Without them the site runs in Demo Mode with local data.

### 2. Import the project
1. vercel.com → **Add New… → Project** → pick `Prop-Guard` → **Import**.
2. Framework preset: **Other** (`vercel.json` sets everything; leave the build/output
   fields as "Override: off" — they come from `vercel.json`):
   - Build command: `npm run build:web`
   - Output directory: `dist`
   - Install command: default (`npm install`)
3. Node.js version: Project Settings → General → Node.js Version → **22.x** (Expo SDK 57
   needs ^20.19.4, ^22.13 or ^24.3 — `package.json` `engines` says the same).
4. Add the environment variables below (Settings → Environment Variables), then **Deploy**.

### 3. Which branch
All current work is on `claude/ecstatic-clarke-ismxpx` (pull request #1, not merged).
- **Preview first (recommended):** Vercel builds every pushed branch automatically. Open
  the deployment for `claude/ecstatic-clarke-ismxpx` (Deployments tab, or the link Vercel
  posts on pull request #1) — that is a normal URL you can open on your iPhone.
- **Production URL** (`<project>.vercel.app` / your domain) is built from the production
  branch (`main` by default). It shows the new app only after PR #1 is merged — or set
  Settings → Git → Production Branch to the feature branch temporarily.

## Environment variables

`EXPO_PUBLIC_*` values are **baked into the JavaScript at build time** and are visible to
anyone using the site. Never put secret keys in them. After changing one, **redeploy**.

| Variable | Needed? | Value |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Optional — blank = Demo Mode | `https://<ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | With the URL | Supabase anon (public) key — RLS protects the data |
| `EXPO_PUBLIC_AI_MODE` | Optional | `mock` (default, on-device) or `remote` (needs the deployed `ai-gateway` function + provider secrets — see `docs/BACKEND_DEPLOYMENT.md`) |
| `EXPO_PUBLIC_DEV_UNLOCK_PRO` | **Decide before going public** | Defaults to **on** when RevenueCat is not configured (every visitor gets Pro features). Set `false` to show the paywall. Web has no billing yet (RevenueCat keys are iOS/Android only). |
| `EXPO_PUBLIC_OCR_ASSETS_URL` | No | Set by the build script to `/ocr`. Only override to serve OCR files elsewhere. |
| `EXPO_PUBLIC_OCR_LANG_URL` | No | Optional separate host for the OCR language model. |
| `EXPO_PUBLIC_OCR_RESTRICTED_HOST` | No | Set to `true` by the build script (model fetched as `.wasm`). |
| `EXPO_PUBLIC_IMPORT_DEBUG` | No | `true` shows the OCR debug panel — leave unset in production. |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` | Native apps only | Not used by the website. |

Server secrets (AI provider keys, `SUPABASE_SERVICE_ROLE_KEY`, `ECON_SYNC_SECRET`, …)
**never** go into Vercel — they belong to Supabase Edge Function secrets
(`docs/BACKEND_DEPLOYMENT.md`).

### Supabase settings when you connect it
- Authentication → URL Configuration → **Site URL**: your Vercel URL (e.g.
  `https://prop-guard.vercel.app`), and add preview URLs under **Redirect URLs**
  (e.g. `https://*-<your-team>.vercel.app/**`). Sign-up confirmation and password-reset
  e-mails link to the Site URL (the app does not pass its own redirect).
- Database: run the migrations (`npx supabase db push`) before users sign in — including
  `20261026000000_account_snapshots.sql` (account snapshots in the private `screenshots` bucket,
  account-ownership check on every row that references an account).
- The Edge Functions already allow browser calls from any origin (CORS `*`).

## After deploying — check on the phone
1. iPhone Safari and Android Chrome: open the URL, tap **Explore the demo**, switch all
   five tabs, open **Edit Account Details**, change a value, **Save Changes**, reload the
   page (values must persist).
2. More → **Import account** → **Upload** a dashboard screenshot (iPhone photos are often
   HEIC; Safari converts them when picking) → Read → review → Confirm. The first read
   downloads the OCR engine (~7 MB).
3. Open a deep link directly (e.g. `/risk`) and reload — it must not show a 404.
4. Optional: Share → **Add to Home Screen** opens it like an app (still the website).

## Browser support
- Minimum: **iOS / iPadOS Safari 15.4**, current Chrome, Edge, Firefox, Samsung Internet.
  The bundle uses ES2022 syntax and APIs (`structuredClone`, `Array.prototype.findLast`,
  `Object.hasOwn`, `.at()`) that need Safari 15.4+.
- Regex **lookbehind** is banned by ESLint in app code (`eslint.config.js`): Safari before
  16.4 cannot parse it, and one such literal makes the whole site a blank page.
- Not available on the web: push/phone notifications (iOS/Android app only), native
  share sheets (downloads instead), RevenueCat purchases.

## What has been verified (and what not)
Verified in this repository's CI-less sandbox: `npm run build:web` from a clean
`public/ocr`, the built `dist/` served with the same SPA rewrite, and browser runs with
**Chromium emulating** iPhone 15, iPhone SE, Pixel 7 and desktop (navigation, account
editing + reload persistence, deep links, screenshot import with self-hosted OCR, no
horizontal overflow, no console errors). **Not** verified: an actual Vercel deployment,
real Safari/WebKit, or a physical iPhone/Android device — do the checks above after the
first deploy.
