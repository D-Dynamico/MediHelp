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

## Open items

- **Planned by the user, not started:** replace Claude symptom triage with
  **`gpt-oss-120b`**, which has a free option. When asked for, it goes behind the
  existing provider interface in `server/src/providers/ai/` (`index.ts`, `llm.ts`,
  `rules.ts`), with the keyless rules engine as the fallback. Follow that
  provider's own docs.
- **The user is looking into Razorpay themselves.** The integration has never
  spoken to the real gateway, and the CSP's Razorpay origins are untested for the
  same reason.
- `SEED_ADMIN_EMAIL` still defaults to `admin@medihelp.test`. It needs a
  decision before deploying.
- Phase 12.3–12.6, then phase 13: 13.1 root `start`, 13.2 serving `client/dist`
  (and checking the CSP there), 13.6 deploy, 13.7 live checks.
- The phase 9 and 10 screens and the redesign have still never been clicked
  through in a browser.
