# 2026-10-02 — Phase 13: production build and serving the client

**Scope**: get the project deployable. The user asked to deploy; 13.1 and 13.2
had to land first, because without them the Render service would serve an API
with no pages, and (as it turned out) the compiled server could not start at
all. 13.6 and 13.7 need the user's Render and Atlas accounts and are handed over
at the end.

Started from `0f6f8f7`, tree clean.

---

## 13.1 Production build

**The built server crashed on its first import.** `npm run build` had always
succeeded, but nobody had run its output: `node dist/server/src/index.js` died
with `Cannot find package '@shared/types.js'`. Three separate faults, all
invisible under `tsx`, which is all development ever used:

1. **`@shared/*` is a TypeScript path alias.** `tsc` uses it to type-check and
   copies it into the output unchanged; Node has no idea what it means.
   *Fix*: `server/scripts/rewrite-shared-imports.ts` runs after `tsc` in the
   server's `build` and rewrites each `'@shared/x.js'` into the right relative
   path. It fails the build if any `@shared/` import survives, so a form it
   misses cannot ship. Considered instead: Node subpath imports (`#shared/*`)
   — their targets may not leave the package folder, and `shared/` is a
   sibling; `tsc-alias` — a dependency for twenty lines of script.
2. **`shared/` compiled to CommonJS.** `tsc` with `NodeNext` picks the format
   from the nearest `package.json`; for `shared/` that was the root one, which
   has no `"type"`. The output then landed under `server/`, whose
   `package.json` says `"type": "module"`, so Node loaded CommonJS as ESM and
   found no exports. *Fix*: `shared/package.json` with `"type": "module"`. The
   client (Vite) does not care either way.
3. **Two files counted `../../..` from themselves** to find the repo
   (`config/env.ts` for `.env`, `providers/storage/local.ts` for `uploads/`).
   The build puts them two folders deeper, so a built server would have read
   no `.env` and written uploads into `server/dist/server/uploads`. *Fix*:
   `config/paths.ts` walks up to the `package.json` that declares workspaces
   and exports `REPO_ROOT`, `SERVER_ROOT` and `CLIENT_DIST`; both files use it.
   (`PORT` from env and binding `0.0.0.0` were already in `index.ts`.)

Plus a root `start` script (`npm start --workspace server`), which is what
Render's start command runs.

## 13.2 Serve the client

`server/src/middleware/serveClient.ts`, mounted in `app.ts` after every API
router and only when `NODE_ENV=production` (Vite serves pages in development):

- `/assets/*` (Vite's fingerprinted output) cached a year, `immutable`; other
  `client/dist` files (favicon, doctor photos) an hour; `index.html` `no-cache`
  so a deploy reaches people on their next load.
- `compression` (new dependency) gzips the client's files. It is mounted after
  the API, so API responses are untouched.
- SPA fallback: GET/HEAD with no file extension and not under `/api`,
  `/socket.io` or `/uploads` gets `index.html`. A miss under those prefixes
  stays a JSON 404, a missing `/logo.png` stays a 404, and a POST to a page
  path is not answered with HTML. No client route has a dot in it, so the
  extension rule cannot swallow a real page.
- If `client/dist` is missing it warns and carries on serving the API, rather
  than refusing to boot.

**CSP gap found and fixed.** Loading Razorpay's real `checkout.js` in the
production build, then opening it with a dummy key, showed it pulls a
fraud-check script from `https://cdn.razorpay.com`, which `script-src` blocked.
Added that origin. The payment frame from `api.razorpay.com` and the calls to
`*.razorpay.com` were already allowed and loaded fine.

## Deploy doc

`docs/DEPLOYMENT.md`:
- Build command is now `npm ci --include=dev && npm run build`. Render shows
  env vars to the build, so `NODE_ENV=production` makes npm skip
  devDependencies — where `tsc`, Vite and `tsx` live. The old `npm install &&
  npm run build` would have failed with `tsc: not found`.
- Two more env vars: `NODE_VERSION=22`, and `MONGOMS_DISABLE_POSTINSTALL=1`,
  which stops `mongodb-memory-server` (a devDependency, now installed on Render
  because of `--include=dev`) downloading a ~100 MB mongod on every build. The
  variable name was confirmed in its `postinstall` helper.
- A table of what the server sends for each kind of path, and which Razorpay
  origins the CSP allows and why.

## Verification

- **HTTP smoke test** (scratchpad `prod-smoke.mjs`): root `npm start` with
  `NODE_ENV=production` against an in-memory MongoDB. 12/12: `/` and deep links
  (`/admin/appointments`, `/doctors/abc`, `/board/x?token=t`) give `index.html`
  with `no-cache`; `/api/health` JSON; `/api/nope` and bare `/api` JSON 404;
  `/logo-missing.png` 404; POST `/admin` JSON 404; favicon one-hour cache;
  Socket.IO polling handshake 200; the hashed JS asset `immutable` and gzipped.
- **Headless browser walk** (scratchpad `prod-browser.mjs`, Playwright's
  Chromium from the npx cache, not the user's Chrome): seeded in-memory DB,
  production build. Public home, doctor detail and the 404 page; patient,
  doctor and admin each signed in and every page of their area rendered with
  the expected heading; a reload of `/account` kept the patient signed in.
  Zero CSP violations after the `cdn.razorpay.com` fix. The only 4xx left are
  the expected ones: `/api/auth/refresh` 401 on signed-out page loads, and
  Razorpay rejecting the dummy key.
- Typecheck and lint clean on both packages. Client checks 14/14. Server
  checks: 18 scripts, 737 assertions, 0 failures (unchanged count).

## 13.6 First deploy (on the user's Render account)

Live at https://medihelp-ea50.onrender.com, database `medihelp-live` (fresh,
seeded by the user from their machine with their own admin and demo passwords;
the old `medihelp` database, with the README's public password on its admin,
was deliberately not used).

**Every database request failed with a 500.** Health, specialities, pages, headers and the
Socket.IO handshake were all fine. The Render log showed
`Invalid namespace specified: net/medihelp-live.waitlists`: the `MONGODB_URI`
in Render read `.mongodb.net/net/medihelp-live`, from editing "the part after
`.net/`". The connection opens without touching a database, so startup and the
health check passed. The user corrected it; `/api/doctors` then returned all
eight doctors. `docs/DEPLOYMENT.md` now shows the exact shape and this failure.

(During this, my read-only probe of `medihelp-live` was refused by the
auto-mode classifier as a production read; I stopped and asked for the Render
log instead.)

## Indexes were never built in production

`connectDb` sets `autoIndex: false` in production, and the seed never built
indexes itself. So a seed run with `NODE_ENV=production`, which the seed requires
before it accepts real passwords, leaves the database with no indexes at all.
That means no unique slot index (double bookings), no unique email, and no TTL on refresh
tokens. The live database was seeded that way.

- `ensureIndexes()` in `models/index.ts` calls `createIndexes()` on all nine
  models, one at a time. It only adds and never drops, unlike `syncIndexes`, so
  it is safe on a live database.
- The seed calls it after clearing and before inserting, so the seed's own data
  is held to the unique indexes.
- `npm run sync:indexes --workspace server` runs it against whatever
  `MONGODB_URI` points at and reports how many indexes it added. That's for the live
  database, and for any other database set up the old way.
- Not chosen: building indexes on server boot in production. It's cheap at
  this size, but the off-in-production default was deliberate, and the seed
  plus the script cover every way a database gets set up here.

**Verified** on an in-memory MongoDB: a seed with `NODE_ENV=production` now leaves
the slot, email and TTL indexes in place. After dropping every index,
`sync:indexes` added 29 back, and a second run added 0. `check:seed` 28/28,
`check:models` 13/13, `check:booking` 95/95, `check:auth:http` 28/28;
typecheck and lint clean.

**The user still has to run `sync:indexes` against `medihelp-live`.** It's their
database, and my reads of it are refused.

## README for the live site

`README.md` got a **Live demo** section near the top with the URL and what a
visitor should expect: the ~1 minute free-tier wake-up, browsing without an
account, the mock payment, and triage on the rules engine without an AI key. The
demo-accounts section now says the live site keeps the same emails but its own
password, and that its admin is private. The README's `Password123!` only works
locally. The live demo password is deliberately not in the README until the user
decides whether to publish it. There is also a short **Deploying** section
(Render settings, pointing to `docs/DEPLOYMENT.md`), and `sync:indexes` is now
under Commands. 13.6 is ticked in `docs/PHASES.md`.

## Open items

- **Refresh shares the sign-in rate limit.** `POST /api/auth/refresh` uses
  `authLimiter` (20 per 15 minutes per IP), and every page load or new tab
  makes one refresh call. The first browser walk did ~21 page loads and the
  21st got a 429, which the client treats as signed out. Real users navigate
  inside the app rather than reloading, but a reviewer clicking around with
  reloads, or several people behind one network address (a clinic's office),
  will hit it. Raised with the user, not changed: it is a security limit and
  their call.
- The client bundle is 517 kB (160 kB gzipped) in one chunk; Vite warns. Route
  level code-splitting would fix it. Not urgent.
- **Run `npm run sync:indexes --workspace server` against `medihelp-live`**
  (user, from their machine), then confirm it reports indexes added.
- 13.7 live checks: the user's, with their passwords (all three logins, a
  booking, the queue in two browsers, a photo after a redeploy if Cloudinary is
  set, a hard-refreshed deep link).
- Carried over from phase 12: Groq key, Razorpay for real, `SEED_ADMIN_EMAIL`,
  and the five lower-risk review findings listed in
  `2026-09-24-phase-12-hardening.md`.
