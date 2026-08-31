# Build phases

Twelve phases, ordered so the app is runnable and demoable as early as possible and
stays that way. Each phase breaks into numbered substeps and ends with **exit
criteria** — observable outcomes, not "implement X". Tick the boxes as they land.

Phases 1–7 are the complete hospital management system. Phases 8–10 are the three
features that set this apart. Phases 11–12 make it presentable, and phase 13 puts
it online. Deployment target and its consequences are in `docs/DEPLOYMENT.md`.

A substep is done when it runs, not when it compiles.

---

## Phase 1 — Scaffold

- [x] **1.1 Root workspace** — `package.json` with npm workspaces (`server`,
      `client`), `concurrently` for `npm run dev`, plus `seed`, `typecheck` and
      `lint` scripts that fan out to both packages.
- [x] **1.2 Server package** — TypeScript, `tsx` watch, `tsconfig` with strict mode
      and path aliases, eslint + prettier, a `src/index.ts` that serves
      `GET /api/health`.
- [x] **1.3 Client package** — Vite + React + TypeScript, Tailwind with the theme
      tokens, React Router with a placeholder home route, Vite proxy for `/api`
      and `/socket.io` to `localhost:4000`.
- [x] **1.4 Shared types** — `shared/types.ts` with `Role`, `AppointmentStatus`,
      `PaymentMode`, `Urgency` and the DTO shapes; wire the path alias so both
      packages import it.
- [x] **1.5 Env and docs** — `.env.example` with every key commented, `.gitignore`
      already in place, README run steps confirmed accurate.

**Exit**: `npm run dev` starts both, `curl localhost:4000/api/health` returns ok,
the client renders a placeholder page, and `npm run typecheck` passes on both.

---

## Phase 2 — Database and models

- [x] **2.1 Config layer** — `config/env.ts` parsing `process.env` through zod once
      into a cached `getSettings()` (plus `reloadSettings()` for tests),
      `config/db.ts` with connect/disconnect and retry, a small logger.
- [x] **2.2 Core models** — `User`, `Doctor`, `Appointment` with their fields,
      enums and the unique partial index on `{doctorId, slotStart}`.
- [x] **2.3 Supporting models** — `Payment`, `RefreshToken` (TTL index),
      `AuditLog`, and the three feature models `TriageAssessment`, `QueueSession`,
      `Waitlist`.
- [x] **2.4 Error plumbing** — `ApiError`, the central error middleware producing
      `{ error: { code, message, details } }`, and a `notFound` handler.
- [x] **2.5 Seed script** — one admin, ~8 doctors across specialities with working
      hours, a handful of patients, and sample appointments spanning past and
      future; prints demo credentials at the end.

**Exit**: `npm run seed` populates Atlas and prints credentials; a bad
`MONGODB_URI` fails at startup with a readable message, not a stack trace;
inserting two appointments on the same doctor and slot raises a duplicate key error.

---

## Phase 3 — Authentication

- [ ] **3.1 Password and token utils** — bcrypt hash/compare, access-token
      sign/verify, opaque refresh-token generation and hashing (`utils/tokens.ts`).
- [ ] **3.2 Auth service** — register (patients only), login, refresh with family
      rotation and reuse detection, logout, `me`.
- [ ] **3.3 Auth routes and validation** — zod schemas per route, the
      `validate(schema)` middleware, cookie setup (`httpOnly`, `sameSite=strict`,
      scoped to `/api/auth`).
- [ ] **3.4 Guards** — `requireAuth`, `requireRole`, `requireOwnership`, and an
      `audit()` helper the later modules reuse.
- [ ] **3.5 Abuse protection** — `express-rate-limit` on `/api/auth/*`, per-account
      `failedLogins` / `lockUntil` with a 6-failure lockout.
- [ ] **3.6 Client auth** — `AuthContext` holding the access token in memory, axios
      instance with a refresh-on-401 interceptor and a single-flight refresh queue,
      `ProtectedRoute` / `RoleRoute`, login and signup pages, silent refresh on app
      load.

**Exit**: all three seeded roles log in; a patient hitting an admin route gets 403;
replaying an old refresh cookie revokes the family and forces re-login; a browser
refresh keeps the user signed in; six bad passwords lock the account.

---

## Phase 4 — Admin panel

- [ ] **4.1 Dashboard stats** — one aggregation returning doctor, patient and
      appointment counts, revenue, today's upcoming, and the latest five bookings.
- [ ] **4.2 Upload middleware** — multer with MIME plus magic-byte checking, a 2 MB
      cap, randomised filenames, the `providers/storage` local implementation, and
      the Cloudinary implementation behind the same interface (local stays the
      default; Cloudinary activates only when the keys are set, because Render's
      disk is ephemeral).
- [ ] **4.3 Add doctor** — multipart endpoint creating the `User` and `Doctor`
      together in one transaction, with a validated speciality list.
- [ ] **4.4 Doctor management** — list, edit, and soft delete (`isActive: false`)
      so appointment history survives.
- [ ] **4.5 Appointments admin** — paginated list with filters, plus cancel and
      mark-completed actions that go through the shared appointment service.
- [ ] **4.6 Admin UI** — layout shell with sidebar, stat tiles, latest-bookings
      table with cancel, add-doctor form with image preview, doctor list,
      appointments table.

**Exit**: a doctor added through the UI can log in with the given password and
appears in the public list; the stat tiles match the database counts; cancelling
from the dashboard reopens the slot.

---

## Phase 5 — Doctor dashboard

- [ ] **5.1 Profile endpoints** — read and update own profile (about, fees,
      address, availability), ownership-checked.
- [ ] **5.2 Availability model** — working hours per weekday and slot duration, with
      validation that end beats start and windows do not overlap.
- [ ] **5.3 Appointment list** — own appointments with patient name, age, date,
      time, payment mode and status; filters for today, upcoming and past.
- [ ] **5.4 Actions** — complete and cancel, guarded by ownership, writing audit
      rows and settling cash payments on completion.
- [ ] **5.5 Earnings** — aggregation over completed and paid appointments; total,
      this month, and appointment/patient counts.
- [ ] **5.6 Doctor UI** — earnings and count tiles, appointment table with actions,
      profile editor with the availability grid.

**Exit**: completing an appointment raises the earnings tile by exactly the fee; a
doctor cannot act on another doctor's appointment even by editing the id in the URL.

---

## Phase 6 — Patient booking

- [ ] **6.1 Public doctor endpoints** — list with speciality filter and search,
      detail by id, both excluding inactive doctors.
- [ ] **6.2 Slot generation** — `utils/slots.ts` building candidate slots from
      working hours and slot duration, minus non-cancelled appointments, minus
      anything in the past.
- [ ] **6.3 Booking service** — availability re-check, fee and speciality snapshot,
      token allocation, appointment write, with the duplicate-key error mapped to a
      409.
- [ ] **6.4 Patient endpoints** — my-appointments, cancel own, profile read/update.
- [ ] **6.5 Patient UI** — doctor browse and filter, doctor detail with a date strip
      and slot grid, booking confirmation, my-appointments with cancel.

**Exit**: a booked slot disappears from the available list and appears on both the
patient's and the doctor's screens; two simultaneous bookings for one slot produce
exactly one appointment and one clean 409.

---

## Phase 7 — Payments

- [ ] **7.1 Provider interface** — `createOrder`, `verifySignature`, `refund`, with
      the provider chosen from env at startup.
- [ ] **7.2 Mock provider** — the default: fake order id, immediate paid status, so
      the whole flow demos with no keys.
- [ ] **7.3 Razorpay provider** — real order creation and HMAC-SHA256 signature
      verification, activated only when the keys are present.
- [ ] **7.4 Cash flow** — `pending_at_desk` on booking, settled when the doctor or
      admin completes the appointment.
- [ ] **7.5 Payment records and refunds** — a `Payment` row per attempt, voided or
      refunded on cancellation, with the webhook route made idempotent.
- [ ] **7.6 Checkout UI** — payment-mode choice at booking, gateway handoff, clear
      paid / pending / failed status on the appointment card.

**Exit**: both modes complete end to end with no keys set; sending a tampered
amount in the request body changes nothing, because the fee comes from the doctor
record; replaying a webhook does not double-credit.

---

## Phase 8 — AI symptom triage *(differentiator)*

- [ ] **8.1 Rules engine** — symptom-to-specialty keyword map and a red-flag list
      (chest pain with breathlessness, stroke FAST signs, heavy bleeding,
      anaphylaxis) producing urgency, specialty, intake note and follow-up
      questions.
- [ ] **8.2 Triage service and route** — `POST /api/triage`, zod-validated,
      persisting a `TriageAssessment` and returning its id.
- [ ] **8.3 Claude engine** — used only when `ANTHROPIC_API_KEY` is set:
      schema-constrained JSON, hard timeout, and a `try`/fallback so any failure
      lands on the rules engine with `source: 'rules'`.
- [ ] **8.4 Link to booking** — `triageId` carried into the appointment; the
      doctor's appointment rows show the urgency chip and intake note.
- [ ] **8.5 Triage UI** — symptom entry, result card, emergency banner that replaces
      the booking form with a call-emergency-services notice, specialty-filtered
      doctor list as a suggestion the patient can override.
- [ ] **8.6 Disclaimer** — a medical disclaimer on every triage surface; the copy
      says routing help, not diagnosis.

**Exit**: "crushing chest pain and short of breath" returns `emergency` with the
banner and no booking form; "itchy rash for three days" returns `routine` and
Dermatology; with the API key unset the behavior is identical and `source` is
`rules`.

---

## Phase 9 — Live queue and token board *(differentiator)*

- [ ] **9.1 Socket.IO server** — mounted on the same HTTP server, JWT handshake
      auth, rooms `queue:{doctorId}:{date}` and `user:{userId}`, join/leave rules.
- [ ] **9.2 QueueSession** — created lazily per doctor per day; token allocation
      moved into the booking transaction.
- [ ] **9.3 Doctor controls** — `checkIn`, `callNext` and `complete` mutating the
      session and emitting `queue:update` to the room.
- [ ] **9.4 ETA calculation** — `utils/eta.ts` using `peopleAhead ×
      medianConsultMins`, with the median recomputed from the doctor's last 20
      completed consults on each completion.
- [ ] **9.5 Patient live card** — `useQueue` hook subscribing to the room, showing
      token, people ahead and estimated wait, with a graceful reconnect.
- [ ] **9.6 Waiting-room board** — `/board/:doctorId`, full-screen now-serving plus
      next five, reachable with a signed link and no login.

**Exit**: with three windows open (doctor, patient, board), clicking "next patient"
updates the other two within a second without a refresh; the ETA reflects the
doctor's real consult times, not a constant; a dropped socket recovers on its own.

---

## Phase 10 — Auto-waitlist *(differentiator)*

- [ ] **10.1 Join and withdraw** — waitlist entry with position, one active entry
      per patient per doctor per day, `DELETE` to withdraw.
- [ ] **10.2 Offer on cancellation** — `offerNext(doctorId, slot)` called from the
      shared cancellation path, marking the first `waiting` entry `offered` with a
      10-minute expiry.
- [ ] **10.3 Live notification** — the offer pushed to `user:{patientId}`, logged in
      mock mode so it is visible with no notification provider configured.
- [ ] **10.4 Claim** — `POST /api/waitlist/:id/claim` creating the appointment
      atomically, with the unique slot index guarding against a walk-in race.
- [ ] **10.5 Sweeper** — `jobs/waitlistSweeper.ts` on node-cron, every minute:
      expire stale offers, cascade to the next person, release the slot when the
      list runs out.
- [ ] **10.6 Waitlist UI** — "join waitlist" when a day is full, a claim card with
      a countdown, and the patient's waitlist state on their appointments page.

**Exit**: cancelling a booked slot pushes an offer to the first waitlisted patient
live; letting the window lapse passes it to the next; claiming creates a real
appointment with a token number.

---

## Phase 11 — Client polish

- [ ] **11.1 Layout shell** — header, role-aware navigation, footer, consistent page
      container across all three role areas.
- [ ] **11.2 UI primitives** — Button, Card, Modal, Table, StatTile, Badge, all
      theme-token driven and reused everywhere.
- [ ] **11.3 Async states** — loading skeletons, empty states with a next action,
      toasts for success and failure, and an error boundary per route group.
- [ ] **11.4 Responsive pass** — every screen at mobile width; tables collapse to
      cards rather than scrolling off.
- [ ] **11.5 Accessibility** — labelled form fields, visible focus rings, keyboard
      paths through booking and the doctor actions, sensible contrast in both
      themes.
- [ ] **11.6 Edge pages** — 404, 403, and a friendly offline/reconnecting state for
      the live queue.

**Exit**: every screen works at mobile width; no raw error text and no
spinner-forever state anywhere in the three role journeys.

---

## Phase 12 — Hardening and docs

- [ ] **12.1 HTTP hardening** — `helmet`, `express-mongo-sanitize`, `hpp`, CORS
      allowlist from env, JSON body size cap.
- [ ] **12.2 Audit coverage** — confirm every admin and doctor state change writes
      an `AuditLog` row; add the ones that were missed.
- [ ] **12.3 Security sweep** — walk the checklist in `docs/SYSTEM_DESIGN.md` §3
      against the built routes: role plus ownership on every guarded route, no
      client-supplied fees or roles, no password field ever serialised.
- [ ] **12.4 Config and secrets review** — `.env.example` complete and accurate,
      nothing secret committed, production cookie flags correct.
- [ ] **12.5 Documentation pass** — README with setup, demo credentials and a
      feature tour; `ARCHITECTURE.md` and `SYSTEM_DESIGN.md` reconciled with what
      was actually built; session notes complete.
- [ ] **12.6 Fresh-clone test** — clone to a new directory, set only `MONGODB_URI`
      and `JWT_SECRET`, follow the README, and run the full demo.

**Exit**: a clean clone with only `MONGODB_URI` and `JWT_SECRET` set runs the whole
demo — all three roles, all three flagship features — by following the README alone.

---

## Phase 13 — Deploy

Target: one Render web service serving the API, the websocket and the built
client from a single origin, with Atlas and Cloudinary. The reasoning, the Render
settings and the caveats are in `docs/DEPLOYMENT.md`.

- [ ] **13.1 Production build** — root `start` script, `tsc` server build verified
      from a clean clone, `PORT` read from env and bound on `0.0.0.0`.
- [ ] **13.2 Serve the client** — in production only, Express serves `client/dist`
      with cache headers and an SPA fallback, ordered after `/api` and
      `/socket.io` so neither falls through to `index.html`.
- [ ] **13.3 Behind a proxy** — `trust proxy`, `secure` cookies in production
      (off in development so localhost http still works), rate limiting keyed on
      the forwarded IP rather than the proxy's.
- [ ] **13.4 Cloudinary provider** — the storage implementation activated by
      `STORAGE_PROVIDER=cloudinary`, with the local provider untouched as the
      development default.
- [ ] **13.5 Seed safety** — the seed script refuses to run against a database
      that already has users unless `--force` is passed, so seeding production is
      deliberate and a rerun cannot wipe real data.
- [ ] **13.6 Ship it** — Atlas network access and user, Render service with build,
      start and health-check settings, environment variables set, first deploy.
- [ ] **13.7 Verify live** — the five post-deploy checks in `docs/DEPLOYMENT.md`:
      all three logins, a booking, the live queue in two browsers, a photo upload
      that survives a redeploy, and a hard-refreshed deep link.

**Exit**: the deployed URL runs the full demo — three roles, triage, live queue,
waitlist — with no secret in the repo, an uploaded photo still present after a
redeploy, and the websocket updating a second browser in real time.
