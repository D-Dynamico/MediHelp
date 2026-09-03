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

### 6.1 The connection

`realtime/io.ts` runs Socket.IO on the same HTTP server as the API — one port,
one origin, nothing extra to deploy. Rooms are `queue:{doctorId}:{YYYY-MM-DD}`
and `user:{userId}`, the day being a **UTC** key both sides build from
`dayKeyUtc` in `shared/queue.ts`; two copies of that function would eventually
name two different rooms.

Two identities are allowed through the handshake and are told apart there rather
than per event:

- a **signed-in user** sending an access token in `auth.token`. Their own
  `user:{userId}` room is joined for them, so nothing they send can put them in
  someone else's;
- a **board screen** sending a board token in `auth.board`, which may join
  exactly the one doctor that token names.

A handshake with neither is refused. Joining a queue room leaves any other, and
the joining socket is immediately handed the current snapshot so a screen
switched on mid-morning is never blank.

### 6.2 What travels over it, and what does not

`queue:update` carries `QueueSnapshotDto` — doctor, day, the token being seen,
the tokens still waiting, and the doctor's median consult length. **Numbers
only.** The room holds every patient of that doctor and an unauthenticated
display on a public wall, so a payload with names in it would put the day's
patient list on that wall.

The doctor's screen needs names, so it reads them from `GET /api/doctor/queue`
— authenticated, their own day only — and treats the socket event purely as the
signal to re-read.

### 6.3 Tokens

A token is the **position of the slot in the doctor's day**, derived at booking
from the working hours (`tokenFor`). Not a counter: two concurrent bookings can
never collide, so no lock and no transaction is needed, and the board reads in
time order. A counter would number patients by who clicked "book" first, which
is not the order anyone is seen in. Numbers therefore have gaps where slots went
unbooked, which is honest — token 7 is the seventh slot of the day.

`QueueSession` is one document per doctor per day, upserted the first time
anyone looks at or acts on that day. It holds the token being called, when it
was called, and how many people have been through. "Now serving" is read from
the `in_progress` appointment where there is one, and falls back to the session —
which is what keeps a token on the wall between one patient leaving and the next
being called.

### 6.4 The doctor's controls

`checkIn`, `callNext`, `complete` and `noShow`, all under `/api/doctor/queue`
and all scoped to the signed-in doctor. `callNext` takes the lowest waiting
token — the earliest slot, not the earliest arrival — and refuses while somebody
is already in the room, rather than silently completing that consult. `complete`
and `noShow` delegate to the shared appointment transitions, so a consult
finished from the appointments table means exactly what one finished from the
queue means.

### 6.5 The wait

`shared/queue.ts` owns the arithmetic, because the server and the patient's card
both do it: `etaMinutes(peopleAhead, medianConsultMins)`, rounded to five
minutes and phrased "about", because a forecast given to the minute is read as a
promise. `server/src/utils/eta.ts` re-exports it and adds
`refreshMedianConsultMins`, which recomputes a doctor's median from their **last
twenty finished consults** each time one ends. A median rather than an average:
one consult that genuinely ran ninety minutes must not drag every estimate after
it.

### 6.6 The board

`/board/:doctorId?t=<board token>` is a full-screen dark display with no shell,
no nav and nothing clickable. Its credential is a signed JWT naming one doctor,
carrying no user and no role, good for thirty days, minted on request and never
stored — there is no list of live links to leak. `verifyBoardToken` insists on
`typ: 'board'`; without that check the same secret and issuer would let a board
token pass as a login. The doctor id the snapshot is built from comes out of the
**token**, and the one in the URL is only compared with it.

The board's first read is over HTTP so an expired link can say so in words;
after that the socket keeps it current.

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

POST   /api/triage                     assess free-text symptoms, patient only
GET    /api/triage/:id                 read one back; 404 unless it is yours

POST   /api/appointments               book
GET    /api/appointments/mine          patient's own
PATCH  /api/appointments/:id/cancel
PATCH  /api/appointments/:id/complete  doctor or admin

POST   /api/payments/order             create a gateway order
POST   /api/payments/verify            verify signature
POST   /api/payments/confirm-mock      settle a mock order; refused once real keys are set
POST   /api/payments/webhook           gateway callback, HMAC over the raw body

GET    /api/queue/:doctorId            current queue state
POST   /api/queue/:doctorId/next       doctor calls the next token

POST   /api/waitlist                   join
POST   /api/waitlist/:id/claim         take an offered slot
DELETE /api/waitlist/:id               withdraw

GET    /api/patient/profile
PATCH  /api/patient/profile            multipart, own account only

GET    /api/doctor/profile
PATCH  /api/doctor/profile             multipart, own record only
GET    /api/doctor/earnings
GET    /api/doctor/appointments        ?when=today|upcoming|past|all
PATCH  /api/doctor/appointments/:id/start     stamps consultStartedAt
PATCH  /api/doctor/appointments/:id/complete
PATCH  /api/doctor/appointments/:id/cancel

GET    /api/admin/dashboard
GET    /api/admin/doctors              ?speciality=&search=&includeInactive=
GET    /api/admin/doctors/:id
POST   /api/admin/doctors              multipart, creates User + Doctor in one transaction
PATCH  /api/admin/doctors/:id          multipart; isActive:true reinstates
DELETE /api/admin/doctors/:id          soft delete, keeps appointment history
GET    /api/admin/appointments         paged; ?status=&doctorId=&patientId=&from=&to=
PATCH  /api/admin/appointments/:id/cancel
PATCH  /api/admin/appointments/:id/complete
```

Errors are uniform — `{ error: { code, message, details } }` with the right status.
Validation failures return 422 with per-field details.
