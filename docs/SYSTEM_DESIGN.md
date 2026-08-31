# System design

The deep reference: data models, auth, the three flagship features, and the API
surface. `docs/ARCHITECTURE.md` covers layout; this file covers behavior.

---

## 1. Roles

| Role | How they get an account | Can do |
|---|---|---|
| `admin` | Seeded only — never self-registerable | Everything: stats, doctor CRUD, all appointments |
| `doctor` | Created by an admin, with a temporary password | Own profile, own appointments, own queue, earnings |
| `patient` | Self-registers | Own profile, browse and book, own appointments, waitlist |

---

## 2. Data models

**`User`** — `name`, `email` (unique, lowercase), `passwordHash` (`select: false`),
`role`, `phone`, `dob`, `gender`, `image`, `isActive`, `failedLogins`, `lockUntil`

**`Doctor`** — `userId` → User, `speciality`, `degree`, `experience`, `about`,
`fees`, `address{line1,line2}`, `available`, `slotDurationMins`,
`workingHours[{day,start,end}]`, `rating`, `medianConsultMins`

**`Appointment`** — `patientId`, `doctorId`, `slotStart`, `slotEnd`, `tokenNumber`,
`status` (`booked | checked_in | in_progress | completed | cancelled | no_show`),
`cancelledBy`, `amount`, `payment{mode, status, orderId, paymentId}`, `triageId`,
`docSnapshot` (fees and speciality frozen at booking time, so history survives a
doctor changing their fee), `consultStartedAt`, `consultEndedAt`

**`Waitlist`** — `doctorId`, `patientId`, `date`, `preferredWindow`, `position`,
`state` (`waiting | offered | claimed | expired | withdrawn`), `offeredAt`,
`offerExpiresAt`, `offeredSlot`

**`TriageAssessment`** — `patientId`, `symptomsText`,
`structured{duration,severity,redFlags[]}`, `urgency`
(`routine | urgent | emergency`), `recommendedSpeciality`, `intakeNote`, `source`
(`rules | llm`), `modelUsed`

**`Payment`** — `appointmentId`, `mode`, `amount`, `status`, `gatewayOrderId`,
`gatewayPaymentId`, `signatureVerified`, `raw`

**`QueueSession`** — `doctorId`, `date`, `currentToken`, `lastCalledAt`,
`servedCount`, `avgConsultMins`

**`RefreshToken`** — `userId`, `tokenHash`, `family`, `expiresAt`, `revokedAt`,
`replacedBy`, `ip`, `ua`

**`AuditLog`** — `actorId`, `actorRole`, `action`, `targetType`, `targetId`,
`meta`, `ip`

### Indexes that carry weight

- **Unique `{doctorId, slotStart}`** on Appointment, partial to non-cancelled
  documents. Double-booking is prevented by the database, not just by app code —
  two simultaneous bookings for one slot means one gets a duplicate-key error,
  which the service turns into a clean 409.
- `{patientId, status}` and `{doctorId, slotStart}` for the list views.
- `{doctorId, date, position}` on Waitlist for ordered offers.
- TTL index on `RefreshToken.expiresAt` so expired tokens clean themselves up.

---

## 3. Authentication and security

**Passwords** — bcrypt, cost 12. `passwordHash` is `select: false`, so it can only
leak if someone asks for it explicitly.

**Access token** — JWT, 15 minutes, returned in the JSON body and held **in memory**
on the client. Never `localStorage`; that is the XSS exfiltration path.

**Refresh token** — an opaque 32-byte random value stored **hashed** in Mongo, sent
as an `httpOnly`, `sameSite=strict` cookie (`secure` in production) scoped to
`/api/auth`. Rotated on every use.

`sameSite=strict` is affordable because the client and API ship on one origin
(see `docs/DEPLOYMENT.md`) — the cookie is never a cross-site request, so it
needs no relaxation and the app needs no separate CSRF token layer. Splitting the
frontend onto its own domain later would force `sameSite=none` and bring that
requirement back; treat it as a security decision, not a hosting one.

**Reuse detection** — each refresh token belongs to a `family`. Presenting a token
that was already rotated means it was stolen: the whole family is revoked and the
user must log in again.

**Authorization** — `requireAuth` verifies the access token and attaches the user;
`requireRole('admin')` gates by role; `requireOwnership` additionally checks the
resource belongs to the caller. Role alone is the classic hole in these projects —
a doctor with a valid token must not be able to complete another doctor's
appointment by changing an id in the URL.

**Brute force** — `express-rate-limit` on `/api/auth/*` plus per-account
`failedLogins` / `lockUntil` (locks after 6 failures).

**Input** — every body, query and param goes through a zod schema via
`validate(schema)`. Unknown keys are stripped, so a client cannot smuggle
`role: "admin"` into a registration.

**Query injection** — the defence is that boundary, not mongoose's
`sanitizeFilter`, which is deliberately off. Because every field is validated and
typed before it reaches a service, an object can never arrive where a string is
expected, and filters are built from typed values rather than forwarded request
objects. `sanitizeFilter` was tried and removed: it rewrites *any* operator
object into an equality match, so every legitimate `$in`, `$gte` or `$exists`
needs `mongoose.trusted()`, and a missed one fails at runtime. It had already
broken refresh-token reuse detection — the family revocation threw a cast error
instead of running, so replayed tokens went uncaught. **The rule that replaces
it: never build a filter from an object the client sent.**

**Transport and headers** — `helmet`, `express-mongo-sanitize`, `hpp`, and a JSON
body size cap. No CORS layer: client and API share an origin in both environments
(Vite proxies in development, Express serves the built client in production), so
there is no cross-origin request to allowlist. `trust proxy` is set in production
so `secure` cookies and rate-limit IPs work behind Render's proxy.

**Uploads** — multer with a MIME plus magic-byte check, a 2 MB cap, randomised
filenames, served from a path that cannot execute anything.

**Audit** — every state-changing admin or doctor action writes an `AuditLog` row.

**Money and identity are server-side facts.** The fee charged comes from the doctor
record; the acting user comes from the verified token. Neither is ever read from
the request body.

---

## 4. Core flows

### Booking

1. Client asks for a doctor's free slots on a date.
2. Server generates candidate slots from `workingHours` and `slotDurationMins`,
   subtracts non-cancelled appointments, returns what is left.
3. Client posts `{doctorId, slotStart, paymentMode, triageId?}`.
4. Service re-checks availability, snapshots fee and speciality, allocates the next
   `tokenNumber` for that doctor and day, writes the appointment. The unique index
   is the final arbiter on races.
5. Payment: `cash` becomes `pending_at_desk`; gateway creates an order and the
   appointment is confirmed once the signature verifies.

### Cancellation

Any cancellation (patient, doctor or admin) sets `status: cancelled`, records
`cancelledBy`, voids or refunds the payment row, then calls
`waitlist.offerNext(doctorId, slot)`. The freed slot is immediately bookable again.

### Completion

The doctor marks the consult complete. This stamps `consultEndedAt`, settles a cash
payment, updates the doctor's rolling `medianConsultMins` from the last 20
consults, and advances the queue.

---

## 5. Flagship feature: AI symptom triage

**Goal** — replace "pick a doctor from a grid" with a guided flow that routes the
patient to the right specialty and warns them when the answer is not an appointment
at all.

`POST /api/triage` takes free-text symptoms and returns
`{urgency, recommendedSpeciality, intakeNote, questionsToAsk[]}`.

- The **default engine is deterministic and offline** (`providers/ai/rules.ts`): a
  symptom-to-specialty keyword map plus a red-flag list (chest pain with
  breathlessness, stroke FAST signs, heavy bleeding, anaphylaxis) that returns
  `emergency` and shows a "call emergency services now" banner instead of a
  booking form.
- When `ANTHROPIC_API_KEY` is set, `providers/ai/llm.ts` uses Claude with a
  schema-constrained JSON response and a hard timeout. **Any failure — timeout, bad
  JSON, rate limit — falls back to the rules engine.** The booking flow is never
  blocked on a network call.
- The assessment is persisted and linked from the appointment, so the doctor sees
  the urgency chip and structured intake note before the patient walks in.
- The specialty recommendation is a **filter, not a lock** — the patient can still
  pick any doctor. A medical disclaimer sits on every triage screen. This is
  routing help, not diagnosis, and the copy says so.

---

## 6. Flagship feature: live queue and token board

**Goal** — patients stop guessing when they will be seen.

- `realtime/io.ts` runs Socket.IO on the same HTTP server with **JWT handshake
  auth** (access token in `auth.token`). Rooms: `queue:{doctorId}:{date}` and
  `user:{userId}`.
- Each booking gets a sequential `tokenNumber` for that doctor and day, allocated
  with the appointment itself.
- Doctor actions — `checkIn`, `callNext`, `complete` — mutate `QueueSession` and
  emit `queue:update` to the room.
- `utils/eta.ts` computes each waiting patient's ETA as
  `peopleAhead × medianConsultMins`, where the median is a rolling figure over the
  doctor's last 20 completed consults. Real data, not a fixed 15-minute guess.
- Patients see a live card: *Token 14 · 3 ahead · about 18 min.*
- `/board/:doctorId` is a full-screen waiting-room display — now serving plus the
  next five — reachable with a signed board link, no login.

---

## 7. Flagship feature: auto-waitlist

**Goal** — a cancelled slot should never go to waste.

- When a day is full, the booking screen offers **Join waitlist**, creating a
  `Waitlist` entry with a position.
- On any cancellation, `offerNext` marks the first `waiting` entry as `offered`
  with `offerExpiresAt = now + 10 minutes` and pushes a live notification to
  `user:{patientId}`.
- `POST /api/waitlist/:id/claim` creates the appointment atomically; the unique
  slot index guards against a race with a walk-in booking.
- `jobs/waitlistSweeper.ts` runs every minute: expired offers become `expired` and
  cascade to the next person. If the list runs out, the slot returns to open
  inventory.

---

## 8. API surface

```
POST   /api/auth/register              patient self-signup
POST   /api/auth/login
POST   /api/auth/refresh               rotates the refresh cookie
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/doctors                    public list, filter by speciality
GET    /api/doctors/:id
GET    /api/doctors/:id/slots?date=    free slots for a day

POST   /api/triage                     symptom assessment

POST   /api/appointments               book
GET    /api/appointments/mine          patient's own
PATCH  /api/appointments/:id/cancel
PATCH  /api/appointments/:id/complete  doctor or admin

POST   /api/payments/order             create a gateway order
POST   /api/payments/verify            verify signature
POST   /api/payments/webhook           gateway callback

GET    /api/queue/:doctorId            current queue state
POST   /api/queue/:doctorId/next       doctor calls the next token

POST   /api/waitlist                   join
POST   /api/waitlist/:id/claim         take an offered slot
DELETE /api/waitlist/:id               withdraw

GET    /api/doctor/profile
PATCH  /api/doctor/profile
GET    /api/doctor/appointments
GET    /api/doctor/earnings

GET    /api/admin/dashboard
GET    /api/admin/doctors
POST   /api/admin/doctors              multipart, creates User + Doctor
PATCH  /api/admin/doctors/:id
DELETE /api/admin/doctors/:id          soft delete, keeps appointment history
GET    /api/admin/appointments
```

Errors are uniform — `{ error: { code, message, details } }` with the right status.
Validation failures return 422 with per-field details.
