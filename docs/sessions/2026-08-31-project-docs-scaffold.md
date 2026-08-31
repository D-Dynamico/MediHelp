# 2026-08-31 — Project docs and session protocol

## Scope

Set up the written memory for MediHelp before any code is written: `CLAUDE.md`,
the `docs/` reference set, the phase plan, and a Stop hook that reminds each
session to keep them current.

## Changes

- **`CLAUDE.md` (85 lines)** — session protocol first, then a documentation map,
  the stack, ground rules and commands. Deliberately short: it is loaded into
  every session's context, so detail belongs in `docs/`, not here.
- **`docs/ARCHITECTURE.md`** — folder layout, layering rules (routes →
  controllers → services → models), module ownership, and the swappable-provider
  pattern for payments, storage and AI. Written so a new session can place a file
  correctly without reading the code.
- **`docs/SYSTEM_DESIGN.md`** — data models with the indexes that matter, the auth
  and security design, the three flagship features in depth, and the API surface.
  This is the file to read before touching behavior.
- **`docs/WORKFLOW.md`** — commit style (plain language, no conventional-commit
  prefixes or jargon, with good/bad examples), the session-note template, a
  docs-upkeep table, and the definition of done.
- **`docs/PHASES.md`** — twelve phases, each broken into 5–6 numbered substeps
  (69 in total), with exit criteria. Ordered so the app is runnable early: phases
  1–7 are the complete hospital system, 8–10 are the three differentiators, 11–12
  are polish and hardening. Exit criteria are written as observable outcomes, not
  "implement X", so a phase cannot be ticked off on reading the code alone. The
  substeps are sized to be one sitting each and ordered so a phase stays runnable
  partway through — server before client in every phase, so the UI is always built
  against a working endpoint.
- **`.claude/settings.local.json`** — Stop hook printing the protocol reminder.
  Local, not project, settings so it is a personal reminder rather than something
  imposed on anyone who clones the repo; added to `.gitignore` for the same
  reason.
- **`README.md`** — rewritten from a one-line stub into a human-facing intro,
  doc index and setup steps.
- **`.gitignore`** — `.env`, `node_modules`, uploads, build output, local settings.

**Why the docs came first**: the session protocol only works if the docs it points
at exist. Writing them up front also forced the data model, auth design and phase
boundaries to be settled before any code locks them in.

## Verification

- `CLAUDE.md` is 85 lines, under the 100-line ceiling (`wc -l`).
- Hook JSON parses and the command resolves correctly
  (`node -e "require('./.claude/settings.local.json')"` prints the echo command).
- The hook itself has not been observed firing — a Stop hook fires outside the
  turn that writes it, and the settings watcher does not pick up a `.claude/`
  directory that did not exist when the session started. Open `/hooks` once or
  restart Claude Code to load it.

## Open items

- No code yet. Phase 1 (scaffold) is next.
- `MONGODB_URI` for an Atlas cluster is still needed before Phase 2 can be
  verified; there is no local `mongod` on this machine.
- `.env.example` will be created in Phase 1 — the README already references it.

---

# Phase 1 — Scaffold

Working on branch `phase-1-scaffold`. One commit per substep, this log updated
with each.

## 1.1 Root workspace

- Root `package.json` with npm workspaces (`server`, `client`) and `concurrently`
  driving `npm run dev`. Scripts fan out with `--workspaces --if-present` so
  `typecheck` and `lint` keep working before both packages define them.
- **Why workspaces**: one `npm install` and one `node_modules` for the whole repo,
  and the client can depend on shared types without a publish step.
- Files: `package.json`, `package-lock.json`.
- Verified: `npm install` clean (0 vulnerabilities), `npx concurrently --version`
  → 9.2.4.

## 1.2 Server package

- `server/` on Express 5 + TypeScript, run in development with `tsx watch`.
  `createApp()` lives in `app.ts` separately from the `index.ts` bootstrap so
  tests and the Socket.IO server in phase 9 can wrap the same app instead of
  starting a second one.
- `tsconfig.json` is strict, plus `noUncheckedIndexedAccess` and `noUnusedLocals`.
  `rootDir` is the repo root and `@shared/*` is mapped to `../shared/*`, so the
  server can import shared types in 1.4 — that is also why the built entry point
  is `dist/server/src/index.js`.
- ESLint 9 flat config with `consistent-type-imports`, since `type: "module"` plus
  NodeNext makes accidental value imports of type-only modules a runtime error.
- Files: `server/package.json`, `server/tsconfig.json`,
  `server/tsconfig.build.json`, `server/eslint.config.js`, `server/src/app.ts`,
  `server/src/index.ts`.
- Verified: `npm run typecheck` and `npm run lint` both clean;
  `curl localhost:4000/api/health` → `{"status":"ok","uptime":4.74}`.

## 1.3 Client package

- `client/` on Vite 6 + React 19 + TypeScript, Tailwind 3, React Router 7.
  A single app with role-guarded route groups, so `routes/router.tsx` is the one
  place route groups get added in later phases.
- Vite proxies `/api` and `/socket.io` (with `ws: true`) to `localhost:4000`, so
  there is no CORS setup in development and the websocket upgrade in phase 9 will
  already work.
- Tailwind carries the theme tokens (`brand`, `ink`, `surface`) and
  `darkMode: 'class'` from the start, so phase 11's polish is a matter of using
  the tokens rather than retrofitting them.
- Aliases `@/*` → `src` and `@shared/*` → `../shared` are set in both
  `vite.config.ts` and `tsconfig.json`; the editor and the bundler have to agree
  or one of them silently breaks.
- The home page fetches `/api/health` and shows the result — a live check that the
  proxy works, not just a static placeholder.
- Files: `client/package.json`, `vite.config.ts`, `tsconfig.json`,
  `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`, `index.html`,
  `src/main.tsx`, `src/index.css`, `src/routes/router.tsx`, `src/pages/Home.tsx`.
- Verified: `npm run dev` starts both; `curl localhost:5173/` serves the app shell
  and `curl localhost:5173/api/health` returns the API's response through the
  proxy. `npm run build --workspace client` succeeds (42 modules) and the built
  CSS carries the theme tokens (`body{background-color:rgb(246 248 251...)}`,
  `text-brand-700`).
- **Not verified**: no visual browser check — the Chrome extension is not
  connected in this environment. The production build plus the proxied fetch is
  the strongest check available here.

## 1.4 Shared types

- `shared/types.ts` holds the contract between client and server: roles,
  appointment statuses, payment modes and statuses, urgencies, specialities,
  waitlist states, the uniform `ApiErrorBody`, and the DTOs for user, doctor,
  appointment and slot.
- Written as `as const` arrays with types derived from them
  (`type Role = (typeof ROLES)[number]`), so each list is one declaration that
  serves both runtime validation and the type system. `zod` enums in phase 2/3
  will be built from these arrays rather than repeating the strings.
- `ACTIVE_APPOINTMENT_STATUSES` is separated out with a `satisfies` check: it is
  the set that still occupies a slot, and it drives both the unique-index filter
  and slot generation. Getting that list wrong in two places is how double
  bookings appear, so it is declared once.
- The file has no imports, so it stays usable from either runtime.
- Wired in on both sides: the server's `/api/health` is typed with
  `HealthResponse` and a new `/api/specialities` returns the shared list; the home
  page renders the specialities and types the health response.
- **Snag**: after installing the client dependencies, `tsx` died with
  `The package "@esbuild/win32-x64" could not be found`. npm had hoisted a shared
  esbuild without its platform binary — the known npm optional-dependency bug.
  Fixed by deleting `node_modules` and `package-lock.json` and reinstalling; the
  committed lockfile is from that clean install.
- Verified: both alias directions resolve at runtime, not just in the type
  checker. `curl localhost:4000/api/specialities` returns all eight from the
  shared value import through `tsx`, and `Gastroenterologist` appears in the
  client's production bundle, proving the Vite alias resolves too. Typecheck and
  lint clean on both workspaces.

## 1.5 Env and docs

- `.env.example` documents every key with a comment, grouped by concern, and says
  up front that only `MONGODB_URI` and `JWT_SECRET` are required — the rest have
  working local defaults (`PAYMENT_PROVIDER=mock`, `STORAGE_PROVIDER=local`, empty
  `ANTHROPIC_API_KEY` meaning the rules engine). It also carries the
  restart-after-change warning, since `getSettings()` caches.
- `server/uploads/.gitkeep` so the folder the local storage provider writes to
  exists in a fresh clone; `.gitignore` already keeps its contents out.
- README updated to say phase 1 of 12 is done, with accurate commands — and an
  explicit note that `npm run seed` arrives in phase 2, rather than leaving a
  command in the setup block that would fail today.

## Phase 1 exit check

Ran from a clean start, after killing the stray dev servers holding ports 4000
and 5173:

| Check | Result |
|---|---|
| `npm run dev` starts both | server on :4000, client on :5173 |
| `curl :4000/api/health` | `{"status":"ok","uptime":3.53}` |
| `curl :5173/api/health` (proxied) | `{"status":"ok","uptime":3.61}` |
| Client serves the app shell | `#root` present |
| `npm run typecheck` | clean on both workspaces |
| `npm run lint` | clean on both workspaces |
| `npm run build` | both build; shared value present in the client bundle |

Phase 1 complete; boxes ticked in `docs/PHASES.md`.

## Open items after phase 1

- No visual browser check has been possible this session — the Chrome extension
  is not connected. Worth a manual look at http://localhost:5173 before phase 11.
- `MONGODB_URI` for an Atlas cluster is needed before phase 2 can be verified end
  to end; there is no local `mongod` on this machine.
- Work is on branch `phase-1-scaffold`, not merged to `main`.

---

# Deployment decisions

The project is going to be deployed, which forced three choices before phases
3, 4 and 7 bake in assumptions that only break in production.

- **One service, one origin** — Express serves `/api`, `/socket.io` and the built
  client. **Why**: it keeps the refresh cookie at `sameSite=strict`. A split
  deployment (frontend on Vercel, API elsewhere) would force `sameSite=none`,
  which sends the cookie cross-site and reopens the CSRF hole `strict` closes for
  free — meaning a CSRF token layer we otherwise never need. It also removes CORS
  from both environments and keeps the client free of any API base URL, so there
  is no environment-specific client build.
- **Render free tier** — supports websockets and a long-lived process, which
  Socket.IO and the `node-cron` sweeper both require (Vercel serverless could not
  host either). It sleeps after 15 minutes: first request takes ~50s, and the
  sweeper does not run while asleep. Accepted, because the claim window is checked
  against the clock at claim time rather than trusted to have been swept, so
  waitlist offers expire *late*, never *wrongly*. Documented rather than papered
  over with an external pinger.
- **Cloudinary for images** — Render's disk is ephemeral, so `server/uploads/`
  would be wiped on every redeploy and doctor photos would vanish. The storage
  provider interface was already planned, so this is one implementation file plus
  keys; local disk stays the development default when no keys are set.

Docs changed: new `docs/DEPLOYMENT.md` (topology, Render settings, Atlas and
Cloudinary setup, pre-deploy checklist, five post-deploy checks);
`docs/ARCHITECTURE.md` gained a production-topology section; `docs/SYSTEM_DESIGN.md`
records why `sameSite=strict` is affordable and drops the CORS allowlist that the
same-origin decision makes unnecessary; `docs/PHASES.md` gained **phase 13**
(7 substeps) and 4.2 now includes the Cloudinary implementation; `.env.example`
gained the Cloudinary keys and an honest `CORS_ORIGINS` note; README links the new
doc and says 13 phases.

No application code changed — the static-serving branch, `trust proxy` and the
Cloudinary provider are phase 13 and 4.2 work.

---

# Phase 2 — Database and models

## 2.1 Config layer

- `config/env.ts` parses `process.env` through a zod schema once and caches it in
  `getSettings()`; `reloadSettings()` re-reads for scripts and tests. `.env` is
  read from the repo root, resolved from the module's own path rather than `cwd`,
  because npm runs the server with `cwd` set to `server/`.
- Required keys carry their own error text, so a missing one says what to do
  rather than "expected string, received undefined". Everything else has a
  default, which is what makes "only MONGODB_URI and JWT_SECRET are required"
  true rather than aspirational.
- `useCloudinary` is derived, not configured: it is true only when the provider is
  chosen *and* all three keys are present. A half-configured Cloudinary silently
  falling back to local disk in production is exactly the bug this prevents.
- `config/db.ts` connects with a 10s server-selection timeout and wraps failures
  in a message naming the three things that are usually wrong (URI, database user,
  Atlas network access). `redactUri()` masks the password so a connection string
  can appear in a log line safely. `autoIndex` is on outside production —
  index builds should be a deliberate act against a live database.
- `config/logger.ts` is a ~30 line level-filtered logger. It reads the level
  lazily and falls back to `debug` if settings have not parsed, so a
  configuration error is never swallowed by the logger that is meant to report it.
- `index.ts` now connects before listening, binds `0.0.0.0` (Render's health check
  cannot reach `localhost`), and prints startup failures as a message rather than
  a stack trace.
- **Snag, recurring**: adding dependencies broke `tsx` again with
  `The package "@esbuild/win32-x64" could not be found` — npm's optional-dependency
  bug, and `npm install` does not self-heal it. Fixed durably by declaring
  `@esbuild/win32-x64` as an **optional** dependency of the server workspace;
  optional means Linux hosts skip it on the platform check, so Render is
  unaffected. If it recurs after a future dependency bump, match the version to
  `npm ls esbuild`.
- Verified, all three startup paths:
  - no `.env` → `MONGODB_URI: required — a MongoDB Atlas connection string…` and
    the `JWT_SECRET` generate-one hint, then exit 1.
  - unreachable host → `Could not connect to MongoDB at … getaddrinfo ENOTFOUND`
    plus the three things to check. No stack trace.
  - a URI with a password → logged as `mongodb+srv://dbuser:***@cluster0…`.
- Typecheck and lint clean.

## 2.2 Core models

- `User` — one account per person whatever the role, so login, guards and audit
  work identically for all three. `passwordHash` is `select: false`, `email` is
  lowercased and unique, `isActive` gives soft delete, and `failedLogins` /
  `lockUntil` back the lockout in phase 3. Two small methods: `isLocked()` and
  `age()` (the admin and doctor appointment tables both show patient age, so it
  belongs on the model rather than in two controllers).
- `Doctor` — the professional profile only: speciality, degree, fees, address,
  availability, working hours and `medianConsultMins`. Identity stays on the
  linked `User`. `medianConsultMins` is **stored, not derived**, because the queue
  recomputes wait estimates on every socket update and must not aggregate the
  last 20 consults each time.
- `Appointment` — the busy one. `docSnapshot` freezes the doctor's name,
  speciality and fee at booking time; without it, a doctor raising their fee would
  silently rewrite the price of every past appointment read through a populate.
- **The double-booking rule is an index, not a check.** Unique on
  `{doctorId, slotStart}`, partial to `ACTIVE_APPOINTMENT_STATUSES`, so cancelled
  and no-show appointments release the slot while active ones hold it. An
  availability check in application code cannot close the window between the check
  and the write; the index can.
- Verified against a **real MongoDB**, not just the type checker: added
  `mongodb-memory-server` and `server/scripts/check-models.ts`
  (`npm run check:models --workspace server`), which spins up a real mongod,
  syncs indexes and asserts behaviour. All nine pass:

  ```
  PASS  partial unique slot index created
  PASS  passwordHash hidden by default
  PASS  passwordHash readable when selected
  PASS  email lowercased on save
  PASS  age() computed from dob
  PASS  duplicate email rejected
  PASS  second booking of the same slot rejected
  PASS  cancelled slot becomes bookable again
  PASS  unknown speciality rejected
  ```

  This also confirms `$in` inside a `partialFilterExpression` is accepted by a
  current MongoDB, which the design depends on.
- **Why an in-memory database**: no Atlas URI exists yet, and deferring all model
  verification to whenever one arrives would mean building phases 3–7 on
  unverified foundations. It stays useful afterwards as the harness for later
  phases.
- `scripts/` is now included in typecheck and lint but excluded from the
  production build. The typecheck immediately earned its keep by rejecting the
  deliberately-invalid speciality in the check script — that one line now carries
  an explicit cast and a comment saying it is testing the database, not the
  compiler.

## 2.3 Supporting models

- `RefreshToken` — stores only the token's **hash**, so a database leak hands out
  no sessions. `family` groups every token issued from one login, which is what
  makes reuse detection possible in 3.2. A TTL index on `expiresAt` lets Mongo
  clear expired rows itself rather than needing a cleanup job.
- `Payment` — the audit trail of every attempt, including failures, kept separate
  from the appointment's current payment state so a disputed payment can be
  reconciled against the gateway's raw payload.
- `AuditLog` — `createdAt` only, no `updatedAt`: an audit row that can be updated
  is not an audit row.
- `TriageAssessment` — `recommendedSpeciality` is optional on purpose, because an
  emergency result deliberately has no recommended doctor; the answer there is not
  an appointment.
- `QueueSession` — one per doctor per day, unique-indexed. Carries
  `lastIssuedToken` as well as `currentToken` so token allocation has a single
  authority instead of counting existing appointments, which would reuse a number
  after a cancellation.
- `Waitlist` — unique partial index allows **one active entry per patient per
  doctor per day** while still letting someone rejoin after withdrawing, and a
  `{state, offerExpiresAt}` index for the sweeper's query. `offerExpiresAt` is
  documented as checked against the clock at claim time, so a sleeping host makes
  offers expire late rather than wrongly — the constraint the deployment decision
  introduced.
- `models/index.ts` gives one import site for models and their types.
- Verified: four more checks added to `check:models`, thirteen now pass,
  including the TTL index, the queue-session uniqueness, the waitlist
  one-active-entry rule, and rejoining after withdrawal.

## 2.4 Error plumbing

- `utils/apiError.ts` — `ApiError` with named constructors (`badRequest`,
  `unauthorized`, `forbidden`, `notFound`, `conflict`, `validation`,
  `tooManyRequests`) and a `toBody()` producing the shared `ApiErrorBody` shape.
  Carrying the status *with* the error means a service can refuse something
  without knowing anything about HTTP plumbing.
- `middleware/error.ts` is the single place an error becomes a response.
  Known errors keep their message; anything unrecognised is treated as a bug —
  logged with its stack, answered with a bare 500. Internals never reach the
  client (in development the message is echoed under `details.dev`, which is
  gated on `isProduction`).
- Four failure kinds are translated rather than leaking:
  - **Mongo duplicate key → 409.** The slot index is matched by name, so a lost
    booking race answers *"That time was just booked by someone else"* instead of
    a 500. This is the payoff for enforcing the rule in the database — the race is
    handled, not just detected.
  - Mongoose validation → 422 with per-field details.
  - A malformed ObjectId in a URL → 400, not a crash.
  - Zod errors → 422 with per-field details, ready for the `validate()` middleware
    in 3.3.
- Express 5 forwards rejected promises to the error middleware by itself, so
  there is no `asyncHandler` wrapper to remember on every route — noted in
  `app.ts` so nobody adds one back.
- **The check found a real bug.** `express.json()` throws its own error for an
  unreadable body, which my first version did not recognise, so malformed JSON
  returned `500 internal_error`. Added `fromBodyParser()`: unreadable JSON is now
  400 and an oversized body is 413. It only claims errors that carry both a
  body-parser `type` and a 4xx status, so it cannot swallow genuine faults.
- Verified with a new `check:errors` script that boots the real app on an
  ephemeral port and calls it over HTTP. Six pass: unknown route 404, malformed
  JSON 400, oversized body 413, validation details, conflict 409, duplicate email
  mapped to 409 with a plain message.

## 2.5 Seed script

- `npm run seed` fills an empty database with an admin, 8 doctors across all
  specialities (with working hours, fees and avatars), 5 patients, and 12
  appointments spread over the past and the next few days — completed, cancelled,
  no-show and upcoming — so every dashboard has something real the moment you log
  in. Finished consults carry `consultStartedAt`/`consultEndedAt`, which the
  earnings view and the queue's median both need.
- **Seed safety, pulled forward from 13.5**: it refuses a database that already
  has accounts unless `--force` is passed, and the refusal says how to override.
  Cheap now, and it means production can never be wiped by a stray run.
- `utils/password.ts` wraps bcryptjs at cost 12. bcryptjs rather than native
  bcrypt: no compiler toolchain, so installs behave the same on Windows and on
  Render's build image. Phase 3 builds on this rather than re-deciding it.
- **Snag**: the first version of the check spawned `npm run seed` as a
  subprocess. The seed did all its work and printed correctly, but the spawned
  process never exited on Windows and the check timed out at 90s. Rather than
  fight it, `seed.ts` now exports `seedDatabase()` and the CLI is a thin wrapper
  guarded by an `import.meta.url === argv[1]` check — the checks import and call
  it directly. Better design anyway: the seed is now callable from tests.
  Confirmed the CLI still runs by pointing it at an unreachable host and seeing
  the connection error, so the guard did not accidentally disable it.
- Verified: 19 checks in `check:seed`, all passing — counts, all eight
  specialities present, passwords hashed and the reported password actually
  signing in, the fee snapshot matching the amount, working hours present for
  slot generation, the `--force` guard refusing and then re-seeding without
  duplicating.

## Phase 2 exit check

`npm run check --workspace server` runs all three check scripts: **38 assertions,
0 failures.**

| Exit criterion | Result |
|---|---|
| `npm run seed` populates the database and prints credentials | Yes — verified against a real MongoDB |
| A bad `MONGODB_URI` fails at startup with a readable message | Yes — `Could not connect to MongoDB at … ENOTFOUND`, no stack trace |
| Two appointments on one doctor and slot raise a duplicate key error | Yes — and the error handler maps it to a 409 with a plain message |

**Not verified against Atlas.** There is still no `MONGODB_URI`, so everything was
proven against a real mongod started by `mongodb-memory-server` rather than a
hosted cluster. What that does not cover: the Atlas connection string format,
network access rules, and index creation on a shared cluster. Worth one
`npm run seed` against Atlas before phase 4 leans on it.

Phase 2 complete; boxes ticked in `docs/PHASES.md`.
