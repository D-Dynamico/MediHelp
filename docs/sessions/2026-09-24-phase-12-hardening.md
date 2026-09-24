# 2026-09-24 — Phase 12: hardening and docs

Scope: all six substeps of phase 12, in the order 12.1 → 12.5, then 12.6 last.
12.4 and 12.5 change `.env.example` and the README, which are exactly what the
fresh-clone test in 12.6 exercises. The work is on `main`, starting at `71fd073`.

Housekeeping first: `phase-8-ai-triage` was fully merged into `main`, so it was
deleted locally and on origin, with the user's go-ahead.

---

## 12.1 HTTP hardening

**What changed.**

- *`helmet` on every response*, with a content security policy written for the
  built client that 13.2 will serve. Scripts come only from `'self'` and
  `checkout.razorpay.com`, with no inline allowance. Styles allow
  `'unsafe-inline'` for React's `style={...}` attributes, plus Google Fonts. Fonts
  come from `fonts.gstatic.com`. Images may come from `data:`, `blob:` and
  `res.cloudinary.com`. `connect-src` adds `*.razorpay.com`, and frames allow
  Razorpay's api and checkout origins. `upgrade-insecure-requests` is **off**:
  Render only serves HTTPS and HSTS covers it, while the upgrade would break the
  production build run locally over plain http. In development Vite serves the
  pages, so the policy only reaches API responses and uploads.
- *`middleware/sanitize.ts` replaces `express-mongo-sanitize` and `hpp`.* Both
  packages assign `req.query`, and that property is getter-only in Express 5. It
  is worse than read-only: `req.query` re-parses the URL on every read (checked in
  `node_modules/express/lib/request.js`), so even editing it in place is lost. The
  middleware removes `$`-prefixed and dotted keys from the body at any depth. It
  collapses a repeated query key to its last value, as `hpp` does, and defines the
  result over `req.query` with the same `Object.defineProperty` pattern as
  `validate.ts`. Express 5's default "simple" query parser never builds nested
  objects, so operator injection through the query was already impossible. The
  real query risk was parameter pollution. No route takes an array in its query.
  The payment webhook is unaffected: its signature is checked against
  `req.rawBody`, not the parsed body.
- *`sanitizeFilter` stays off.* zod is still the primary guard, and this layer is
  defence in depth under it (see `config/db.ts`).
- *CORS via `cors`, only when `CORS_ORIGINS` is non-empty.* It uses the same list
  Socket.IO already reads. **Decision:** the client is same-origin in both
  environments, so nothing is allowlisted by default. The option exists for a
  same-*site* split, such as an admin subdomain. The refresh cookie is
  `sameSite: 'strict'`, so a cross-site origin would pass CORS and still never get
  a working session. The comment in `app.ts` and SYSTEM_DESIGN §3 both say so,
  so nobody reaches for this expecting a split deployment to just work.
- *The JSON body cap* (100 kB) and `trust proxy` were already in place and are
  unchanged.

**Files.** `server/src/app.ts`, `server/src/middleware/sanitize.ts` (new),
`server/scripts/check-hardening.ts` (new), `server/package.json` (`helmet`,
`cors`, `@types/cors`, the `check:hardening` script, which is appended to
`check`), `package-lock.json`. Docs: `SYSTEM_DESIGN.md` §3 "Transport and
headers", `ARCHITECTURE.md` production topology, `DEPLOYMENT.md`, and `PHASES.md`,
where 12.1 is ticked.

**Verified.**

- `npm run check:hardening`: 16/16. It covers the security headers, a CSP that
  allows Razorpay with no inline scripts and no upgrade, CORS off by default, a
  listed origin allowed with credentials, an unlisted one refused, and a repeated
  query key on the real `/api/doctors` returning 200 where zod used to refuse the
  array. On an echo app, it checks that operator and dotted keys are removed at
  any depth and that the last query value wins.
- Every other server check was run one at a time: the same 671 assertions as
  before, 0 failures. That includes `check:payments` (52), so the webhook
  signature still verifies. The total is now 17 scripts and 687 assertions.
- `npm run typecheck`, `npm run lint` and `npm run build`: clean.
- **Not yet verified:** the CSP against the built client in a browser. It can't
  be, until 13.2 serves `client/dist`. Check it then, especially the Razorpay
  checkout, which has never run against the real gateway.

---

## 12.2 Audit coverage

**What was found.** Every route that lets an admin or a doctor change something
already writes an audit row, and only after the change succeeds. That was checked
against a list of every POST, PUT, PATCH and DELETE route. The one socket handler,
`queue:join`, only reads. What the rows *said* was weaker. Profile edits recorded
`fields: Object.keys(req.body)`, and both the doctor's form and the admin's edit
form send the whole form on every save. So every row listed every field, a fee
change looked exactly like a no-op save, and a new photo didn't appear at all,
because the image isn't in the body. No script checked the trail either, apart
from a count of "three or more" in `check-doctor`.

**What changed.**

- *`utils/changes.ts`* reads `directModifiedPaths()` from the user and doctor
  documents before they are saved. Mongoose marks a path only when its value
  really differs, which a throwaway test confirmed for plain fields, the address
  object and the working-hours array. `image` is reported as `photo`.
  **Decision:** use Mongoose's own change tracking rather than diffing by hand,
  because it already handles nested paths and arrays correctly.
- *The fee gets its before and after* (`meta.fees: { from, to }`). It's money, so
  a field name alone isn't enough to answer "who changed the price".
- *`doctorService.updateProfile` and `adminService.updateDoctor` return
  `{ profile | doctor, changes }`*, and the controllers log `changes`. Those two
  controllers are the only callers.

**Files.** `server/src/utils/changes.ts` (new), `modules/doctors/doctor.service.ts`,
`modules/doctors/doctor.controller.ts`, `modules/admin/admin.service.ts`,
`modules/admin/admin.controller.ts`, `server/scripts/check-audit.ts` (new),
`server/package.json` (`check:audit`, appended to `check`). Docs:
`SYSTEM_DESIGN.md` §3 "Audit", and `PHASES.md` with 12.2 ticked.

**Verified.**

- `npm run check:audit`: 22/22. It covers each of the 13 admin and doctor actions,
  with the action name, target and actor checked on the row itself. It also
  checks that a refused action (a doctor cancelling another doctor's appointment)
  writes nothing. For edits, it checks that an unchanged save records
  `changed: []`, that a fee change records `['fees']` with its before and after,
  that a photo-only change records `['photo']`, and that reinstating a doctor
  records `['isActive']`.
- `check:admin` 87, `check:doctor` 94 and `check:upload` 21 are unchanged.
  Typecheck and lint are clean.

**Noticed, for 12.3.** For another doctor's appointment, the doctor routes answer
**403** (asserted in `check-doctor`), while the queue routes answer **404**
(asserted in `check-queue`). Both refuse the action. The difference is whether
the answer admits the appointment exists.

**Left alone.** The patient's own profile edit still records the fields it was
sent. Patients are outside the admin-and-doctor rule. The same helper would fix
it in a few lines if it's ever wanted.

---

## 12.3 Security sweep

**How.** Walked SYSTEM_DESIGN §3 against the code by hand, rule by rule, rather
than running the `security-review` skill. That skill reviews a diff, and there
was no pending diff: 12.3 is a sweep of the whole codebase against a checklist.

**What held (no change needed).**

| Rule | Where it's enforced |
|---|---|
| Role guard on every guarded router | `router.use(requireAuth, requireRole(...))` in admin, doctor, queue, patient, triage, waitlist and the payment routes after the webhook. Appointments guard per route: booking and `mine` are patient-only, and cancel is any role, with ownership checked in the service. |
| Ownership | `assertMayAct` (appointments), `ownAppointment` (payments, queue), `ownEntry` (waitlist), `getOwn` (triage), with the doctor's own id taken from the token |
| Fees are never read from the client | Booking uses `amount: doctor.fees`, and payments read `appointment.amount` |
| Roles are never read from the client | Registration hard-codes `role: 'patient'`, and no schema has a `role` key. zod strips unknown keys. |
| No password is ever serialised | `passwordHash` is `select: false`. Only `login` asks for it. Every response goes through an explicit DTO mapper, and every `$lookup` into `users` has a `$project` that leaves the hash out. |
| Tokens | The access token is held in memory on the client (no `localStorage` anywhere in `client/src`). The refresh cookie is `httpOnly`, `sameSite=strict`, scoped to `/api/auth`, and `secure` in production. It is cleared with the same path. |
| Brute force | `authLimiter` on login and refresh, `registerLimiter`, a lock after 6 failures, and dummy bcrypt work for unknown emails so response timing gives nothing away |
| Inactive accounts | Refused at login, refresh and `/me`. Deactivation revokes refresh tokens. |
| Search | Every `RegExp` built from input is escaped first |
| Payments | `confirm-mock` refuses unless the provider is the mock. The webhook refuses when no secret is set, refuses without a signature, and compares signatures in constant time. `settle` is idempotent. |
| Errors | Production 500s carry no stack or message |

**What changed.**

- *The JWT algorithm is pinned to `HS256`* in both verifiers. jsonwebtoken 9
  already refuses `none` and public-key algorithms for a shared secret, but it
  accepted an `HS512` token signed with our secret. Harmless today, but the
  pinned list doesn't depend on the library's defaults.
- *`verifyAccessToken` refuses any token with a `typ`.* A board token was only
  refused by accident, because it happens to lack `sub` and `role`. `check-queue`
  covered the other direction (an access token used as a board link), not this
  one.
- *SYSTEM_DESIGN §3 "Authorization" corrected.* It said `requireOwnership`
  checks ownership, but no route uses it. Ownership is checked in the services,
  where the record is already loaded. The middleware stays, because it is tested
  in `check-auth-http` and ready if a route ever needs it.

**Files.** `server/src/utils/tokens.ts`, `server/scripts/check-tokens.ts`,
`docs/SYSTEM_DESIGN.md` §3, `docs/PHASES.md` (12.3 ticked).

**Verified.**

- `check:tokens`: 21/21, 4 of them new. The new `typ` and HS512 assertions were
  also run against the old `tokens.ts` and **fail there**, so they test the
  change and aren't passing by accident.
- `check:auth` 26, `check:auth:http` 28, `check:queue` 63 and `check:waitlist` 41
  are unchanged. Typecheck and lint are clean.

**Found and accepted, below the bar for a change.**

1. *403 versus 404 for someone else's record.* The doctor and appointment routes
   answer 403, while the queue answers 404. Both refuse, and each is asserted by
   its own check. The only thing a 403 leaks is that the id exists.
2. *The lockout message reveals that an account exists.* An unknown email always
   gets "do not match", so six wrong tries followed by "too many attempts"
   confirms the email is registered. Registration's 409 already reveals the same
   thing. This is the usual trade-off: an honest lockout message beats a
   confusing one.
3. *A deactivated doctor's access token lasts up to 15 minutes.* This is
   documented in `deactivateDoctor`, and it is the cost of not querying the
   database on every request.
4. *Mock payments in production.* With no Razorpay keys, production runs the
   mock provider, and the "pay" button marks a booking paid with no money moving.
   That is intended for the demo deploy (the ground rule is that the project
   boots with only `MONGODB_URI`). It must stay a conscious choice. 12.4 makes
   sure `.env.example` and the deploy doc say so.
5. *Anyone signed in can join any doctor's queue room.* This is by design: the
   payload carries token numbers and no names, as `check-queue` asserts.

---

## 12.4 Config and secrets review

**What was found.**

- *`.env.example` was missing `LOG_LEVEL`*, which the schema reads. Every other
  key matched, and nothing outside `config/env.ts` reads `process.env` (checked
  across `server/src`, `client/src` and the Vite config).
- *Its `CORS_ORIGINS` comment* still said a separate frontend "would force
  sameSite=none", which contradicts 12.1: the cookie stays `strict`, and only a
  same-site origin works.
- *Nothing secret was ever committed.* `.env` is gitignored and has never
  appeared in any commit on any branch. I searched every added line in the
  history for secret-shaped strings: the three `mongodb+srv` credentials are
  placeholders (`USER:PASSWORD`, `user:pass`, `dbuser:***`), and the one
  `sk-ant-` hit is `sk-ant-not-a-real-key`. The real Atlas password and the real
  `JWT_SECRET` were each compared against the whole history without being
  printed: 0 occurrences. No other secret is set locally.
- *Production cookie flags are correct*, as verified in 12.3: `httpOnly`,
  `sameSite=strict`, `secure` in production, `trust proxy` behind Render, and the
  path scoped to `/api/auth`.
- *`TRIAGE_MODEL=claude-opus-5` is valid*, confirmed against the `claude-api`
  skill's current model table. No change.

**What changed.**

- *`.env.example`:* `LOG_LEVEL` added. The `CORS_ORIGINS` comment now matches
  12.1. `PAYMENT_PROVIDER` spells out that the mock runs in production and marks
  bookings paid with no money moving, that `razorpay` with a missing key falls
  back loudly, and that the webhook secret is optional. `SEED_ADMIN_EMAIL` says to
  use a mailbox you control for a real deploy.
- *`ENV_KEYS` is exported from `config/env.ts`*, and `check-env` holds
  `.env.example` to it in both directions. The example must document every key
  the server reads, and must list no key the server ignores. It also checks that
  the example ships no secret values. **Decision:** this was the one drift a
  review can find but can't prevent, so it's now a check rather than a habit.
- *`DEPLOYMENT.md`* now says what the mock means on a public URL, and to set
  `SEED_ADMIN_EMAIL`.

**Files.** `.env.example`, `server/src/config/env.ts`, `server/scripts/check-env.ts`,
`docs/DEPLOYMENT.md`, `docs/PHASES.md` (12.4 ticked).

**Verified.**

- `check:env`: 15/15, 3 of them new. With `LOG_LEVEL` removed from the example
  for one run, the check **fails** and names the key. The file was then restored.
- Typecheck and lint are clean.

---

## 12.5 Documentation pass

**What changed.**

- *README rewritten around a first-time reader.*
  - Setup now runs in the order it actually works: install, copy `.env`, seed,
    run. It explains the two required keys, including that the Atlas URI needs
    the database name and the IP allowlist.
  - A demo-accounts table covers all eight doctors and five patients, and says
    that production refuses the well-known password.
  - A feature tour covers each role, using the real route paths and a
    two-window setup, so the live parts can be seen working.
  - The check counts are current: 18 scripts, around 700 assertions.
  - Removed "the page shows the live API status", which the redesign took away:
    no client code calls `/api/health` any more.
- *Every tour claim was checked against the code before it was written.*
  - The ten-minute window is `OFFER_WINDOW_MS`.
  - Triage links to the matching doctors with `?triage=`, and the booking
    carries it.
  - The waitlist and the live position both sit on the patient's appointments
    page.
  - The admin can reinstate a doctor through `isActive`.
  - The sandbox sets its own `MONGODB_URI` and `JWT_SECRET`.
  - I didn't promise that the seeded data already has a full day. The waitlist
    walkthrough says how to make one.
- *ARCHITECTURE.md reconciled with the tree.*
  - Module folders are plural, and `*.mapper.ts` files exist.
  - `sanitize` and `audit` are now listed in middleware.
  - The utils list is complete, and `types/express.d.ts`, `scripts/` and
    `shared/queue.ts` are included.
  - `routes/guards.tsx` replaces `ProtectedRoute`/`RoleRoute`, which never
    existed under those names.
  - The module table now says what each module really owns: the public
    catalogue lives in `doctors`, token numbers are given at booking in
    `appointments`, and there is no "cash settlement" in `payments`.
- *SYSTEM_DESIGN.md §8* listed `PATCH /api/appointments/:id/complete`, which no
  router defines. Completion goes through the doctor, queue and admin routes. It
  was also missing `/api/health` and `/api/specialities`. I compared all 47
  documented routes mechanically against every `*.routes.ts`. That stale route
  was the only mismatch.

**Files.** `README.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_DESIGN.md`,
`docs/PHASES.md` (12.5 ticked).

**Verified.** Read against the code as described above. No code changed in this
step.

---

## 12.6 Fresh-clone test

**How.**

- Pushed `main` (`bf34954`) and cloned it **from GitHub** into the scratchpad.
  Then followed the README exactly: `npm install`, `cp .env.example .env`, set
  only `MONGODB_URI` and `JWT_SECRET`, `npm run seed`, `npm run dev`.
- The URI pointed at a **separate database on the same Atlas cluster**,
  `medihelp-freshclone`, so the real `medihelp` data was never touched. It was
  written by a script that only swaps the database name, and neither secret was
  printed. The `JWT_SECRET` was freshly generated.
- The tour was driven as a script through the **Vite dev proxy** (`:5173/api`,
  `/socket.io`), the same path the browser uses, with a real Socket.IO client
  standing in for each patient's screen. I didn't use a headless browser: the
  machine had about 0.3 GB of memory free.

**Results.**

- Install, seed and dev all worked first time. The seed printed exactly the
  logins in the README's table.
- **Every README login works:** the admin, two doctors and all five patients.
- **Triage → book → pay.** A free-text rash description went to Dermatologist.
  The matching doctors were listed, a free slot was booked with a token number,
  the mock payment settled, and the booking read `paid`. The doctor's list shows
  the patient's triage note and urgency.
- **Live queue.** Dr. Rao's queue for today loaded, and the patient's socket got
  the snapshot on joining. Check-in, call-next (with `currentToken` now showing
  their token) and finishing each reached the patient live. The board link opened
  with no sign-in and carried no names.
- **Admin.** The dashboard, all eight doctors and the appointments list loaded.
- **Waitlist, end to end,** set up the way the README describes. Dr. Nair set
  two-hour appointments, so a clear day held three slots. Three patients filled
  it, and a fourth joined the waitlist. When one of the three cancelled, the
  offer reached the waiting patient's socket live, and they claimed it into a
  booking.

**Two things that looked like failures and weren't.**

1. The first run failed the payment and triage-note checks. Both were bugs in
   the tour script, not in the app. The order endpoint answers **201** and the
   script expected 200, so it never called `confirm-mock`. And the note is a
   top-level `intakeNote` on the appointment, not nested. Calling
   `confirm-mock` by hand confirmed the app settles correctly, and the client
   does exactly that when `autoSettled` is set (`client/src/api/checkout.ts`).
   The rerun passed both.
2. The rerun first hit **429 on login**. The tour plus my debugging made more
   than 20 logins from one address within 15 minutes, and the limiter did its
   job. I waited out the window rather than restart the clone with
   `NODE_ENV=test`, which isn't a README step. On the final run, the queue
   walkthrough had nothing left to walk: the seed puts one booking in Dr. Rao's
   queue today, and the first run had already completed it, passing all six
   queue checks.

**Cleanup.** Stopped the clone's servers (ports 4000 and 5173 free). Dropped
`medihelp-freshclone` with a script that refuses unless both the URI and the
live connection name that database. Afterwards the database list showed
`medihelp-freshclone` gone and `medihelp` still there.

**Noticed, not fixed.** A clean exit from `npm run seed` logs "Mongo
disconnected" twice, once as WARN and once as INFO. It's cosmetic, but a
deliberate disconnect shouldn't warn.

---

## Phase 12: closed

All six substeps are done, one commit each. Server checks now number **18
scripts**: 671 assertions before this session, 716 now (`check:hardening` 16,
`check:audit` 22, `check:tokens` +4, `check:env` +3). The client check is
14/14 and was untouched.

---

## Review fixes (`/code-review high 71fd073..HEAD`)

The review of this session's code found nine issues. Ranked by how critical
they are, the user chose to fix the top four. The rest are recorded under open
items.

**What changed.**

1. *A deeply nested body crashed the sanitizer.* A body of about 45,000 nested
   brackets fits under the 100 kB cap and parses fine, but the recursive walk
   overflowed the stack. That came back as a 500 on any route, including
   login, which needs no account. The walk now stops at 32 levels with a 400.
   The deepest real body, the doctor's working hours, is three levels down.
2. *The audit trail reported address edits that never happened.* Both update
   services rebuilt the address as a new object. When no second line was
   stored, that meant `line2: undefined`, and Mongoose counted it as a change.
   The address is now written path by path, and a blank second line means
   none, as it already did when a doctor is added. `changedFields` reports
   `address.line1` and `address.line2` as a single `address`. **Decision:**
   write the paths rather than compare values by hand. Mongoose's tracking
   stays the single source of truth, and a throwaway test confirmed the five
   cases: same/same, none/blank, none/absent, cleared, and a changed first line.
3. *Multipart forms skipped the sanitizer.* multer reads a form inside the
   route, after the app-wide pass has already run and found no body.
   `sanitizeBody` is now a step in `uploadImage`, between reading the form and
   storing the image, so a refused form never leaves a file behind.
4. *Helmet's `Cross-Origin-Opener-Policy: same-origin` would have broken
   Razorpay's popups.* Netbanking and wallets report back from a popup, so the
   money could be taken while the booking stayed unpaid. It's now set to
   `same-origin-allow-popups`. This can't happen until real Razorpay is
   switched on, but it's the most expensive failure on the list.

**Files.** `server/src/middleware/sanitize.ts`, `server/src/middleware/upload.ts`,
`server/src/app.ts`, `server/src/utils/changes.ts`,
`server/src/modules/doctors/doctor.service.ts`,
`server/src/modules/admin/admin.service.ts`, `server/scripts/check-hardening.ts`,
`server/scripts/check-audit.ts`, `docs/SYSTEM_DESIGN.md` §3.

**Verified.**

- `check:hardening` 19/19, 3 of them new: the popup header, the deeply nested
  body returning 400, and a multipart form getting cleaned.
- `check:audit` 26/26, 4 of them new. The admin's new doctor now has no second
  address line, as a blank form field leaves it, and the edit resends the
  unchanged first line. Clearing the second line on the doctor's side records
  `address` once, then nothing on the next save.
- **All four new failure cases were run against the old source and fail
  there:** the header was `same-origin`, the nested body gave a 500, `$where`
  got through the multipart form, and the audit row said `changed:
  ["fees","address"]`. They pass on the fix.
- The whole server suite, run one script at a time: **18 scripts, 723
  assertions, 0 failures.** Typecheck, lint and build are clean.

**Not fixed, by choice.** These are ranked lower and recorded under open items.

---

## Triage moves from Claude to gpt-oss-120b on Groq

**Why.** This is the user's plan from the start of the session: gpt-oss-120b
has a free option, so the triage upgrade costs nothing to switch on. The user
asked to "change the env to grok gpt oss 120b". I read "grok" as **Groq**, the
host that serves `openai/gpt-oss-120b` with a free tier. xAI's Grok is a
different product and doesn't serve this model.

**What changed.**

- *`providers/ai/llm.ts`* now calls Groq's OpenAI-compatible endpoint
  (`https://api.groq.com/openai/v1/chat/completions`) with plain `fetch`
  instead of the Anthropic SDK. The facts were checked against Groq's current
  docs, not memory: the model id `openai/gpt-oss-120b`, strict `json_schema`
  support for it, `reasoning_effort` low/medium/high, `include_reasoning`, and
  `max_completion_tokens`, which counts reasoning tokens (hence 4000). The
  strict schema, the zod parse at the trust boundary, the emergency override
  and the AI disclaimer on the note are unchanged. It adds one new failure case:
  a `finish_reason` other than `stop` (a truncated answer) falls to the rules.
  An error status is logged by code only. The body could echo the patient's
  symptoms.
- *Settings:* `ANTHROPIC_API_KEY` is replaced by `GROQ_API_KEY`, and the
  `TRIAGE_MODEL` default is now `openai/gpt-oss-120b`. `.env.example` explains
  where to get a free key. `index.ts`: `usingClaude` → `usingModel`,
  `assessWithClaude` → `assessWithModel`.
- *`@anthropic-ai/sdk` removed* from the server's dependencies. Nothing else
  used it.
- *The local `.env`* (gitignored, not committed): `ANTHROPIC_API_KEY=` (empty)
  became `GROQ_API_KEY=` (empty, for the user's key), and `TRIAGE_MODEL` became
  `openai/gpt-oss-120b`. It was `claude-sonnet-5`. A backup of the old file is in
  the session scratchpad. **Needs a server restart to take effect**, because
  `getSettings()` is cached.

**Files.** `server/src/providers/ai/llm.ts`, `server/src/providers/ai/index.ts`,
`server/src/config/env.ts`, `server/scripts/check-triage.ts`,
`server/scripts/check-env.ts`, `server/package.json`, `package-lock.json`,
`.env.example`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_DESIGN.md` §5,
`docs/DEPLOYMENT.md`, `docs/PHASES.md` (8.3 note).

**Verified.**

- `check:triage` 97/97, 14 of them new, with `fetch` stubbed, so no key is
  needed:
  - the request goes to Groq's URL with a bearer key, `model:
    openai/gpt-oss-120b`, a strict `json_schema`, low reasoning effort, and
    reasoning left out of the reply;
  - a good answer is used with `source: 'llm'` and the model recorded, and the
    note carries the disclaimer;
  - a model emergency never carries a speciality;
  - a speciality the clinic doesn't have, a truncated answer and a 401 each
    fall to the rules.
- The existing "bad key falls back" checks now make a real call to Groq with a
  fake key. They still pass.
- The first run caught the check reading `TRIAGE_MODEL=claude-sonnet-5` from
  the developer's `.env`. The stubbed checks now unset it, so the default is
  what gets tested.
- Full server suite, one script at a time: **18 scripts, 737 assertions, 0
  failures.** Typecheck, lint and build are clean.
- **Not verified:** a real call with a real Groq key. The user hasn't set one
  yet.

---

## Five more demo patients

**Why.** The user asked for at least four more dummy patient accounts with
passwords.

**What changed.**

- *The seed's `PATIENTS` list grows from 5 to 10*, and is now exported. The new
  patients cover the ages a clinic sees:
  - Ananya Das (20s)
  - Vikram Singh (40s)
  - Meenakshi Pillai (60s)
  - Arnav Gupta (a child, born 2015, for the pediatrician)
  - Deepa Joshi (30s)

  They sign in as `{firstname}@medihelp.test` with the shared demo password
  (`Password123!` in development). Phone numbers come from `demoPhone(index)`,
  so each is distinct and five digits wide. The existing five keep the numbers
  they had.
- *`npm run add:patients --workspace server`* (`scripts/add-demo-patients.ts`)
  adds any missing demo patients to a database seeded before they existed.
  **Decision:** it's a separate script, the same approach as
  `refresh:photos`, because the seed refuses a database that has accounts and
  `--force` would wipe the user's real data. It only inserts, never edits or
  deletes, and does nothing on a second run. It applies the seed's password
  rules through the now-exported `resolvePasswords`, so production refuses
  unless `SEED_DEMO_PASSWORD` is set.
- *Run against the Atlas `medihelp` database with the user's go-ahead.* It
  added the 5 new patients, and the 5 existing ones were untouched. There are
  11 patients in total, because one non-demo account was already there. Each
  new account was verified directly: role `patient`, active, and the demo
  password matches the stored hash.
- *`check-seed`* expects 10 patients and 19 users (it expected 5 and 14). The
  README lists all ten patients.

**Verified.** The add script was first run twice against an in-memory database
holding one old patient: it added 9, then 0, left the old account's hash as it
was, and gave distinct phone numbers. Then it ran on Atlas as above.
`check:seed` 28/28. Full suite: **18 scripts, 737 assertions, 0 failures.**
Typecheck and lint are clean.

---

## Open items

- **Triage on gpt-oss-120b is built but not yet tried for real.** Set
  `GROQ_API_KEY` in `.env` (free key at console.groq.com/keys), restart, and run
  one triage. The log line `Triage fell back to the rules engine` means the call
  failed. Also confirm that Groq's free-tier rate limits suit the demo.
- **The user is looking into Razorpay themselves.** The integration has never
  spoken to the real gateway, and the CSP's Razorpay origins are untested for the
  same reason.
- `SEED_ADMIN_EMAIL` still defaults to `admin@medihelp.test`. The deploy doc and
  `.env.example` now say to set a real mailbox. Choosing it is the user's call,
  at deploy time.
- Phase 13: 13.1 root `start`, 13.2 serving `client/dist`
  (and checking the CSP there), 13.6 deploy, 13.7 live checks.
- The phase 9 and 10 screens and the redesign have still never been clicked
  through in a browser.
- The double "Mongo disconnected" log (WARN then INFO) on a deliberate
  disconnect, seen at the end of `npm run seed`.
- **Review findings left open, lowest risk first:**
  - Helmet's default `Cross-Origin-Resource-Policy: same-origin` would block
    `/uploads` images on a same-site subdomain listed in `CORS_ORIGINS`. The
    normal single-origin setup never hits this. If it ever matters, relax it
    to `same-site`.
  - The CSP's `connect-src` relies on `'self'` covering `wss:`. Old WebKit
    didn't, and Socket.IO falls back to polling there. Adding `wss:` would
    remove the dependency.
  - The change-capture lines (`feesBefore`, `changes`) are copied in the doctor
    and admin services. One helper in `utils/changes.ts` would stop them
    drifting apart.
  - The uploads route still sets its own `nosniff` header, which helmet now
    sets everywhere. It's redundant but harmless.
  - Collapsing a repeated query key to its last value is a deliberate 12.1
    decision, not a defect. A future route that takes an array in its query
    must opt out.
