# 2026-09-02 — Seed passwords, and a review of phases 6–7

Scope for the session: close the seed default-password item carried in the
phase 6–7 handoff, then run a code review over the phases 6–7 diff before
phase 8 builds on it.

Starting point: branch `phases-1-3-foundation` at `21700b1`, phases 1–7 done,
five commits unpushed.

---

## The seed's shared password

**The problem.** Every seeded account — the admin and all eight doctors and five
patients — was hashed from one constant, `DEMO_PASSWORD = 'Password123!'`,
written in `server/src/seed.ts` and therefore published in this repo.
`SEED_ADMIN_PASSWORD` existed but fell back to that same constant when unset,
which is exactly what `.env.example` ships. Nothing gated any of this on
`NODE_ENV`, and `docs/DEPLOYMENT.md` documents seeding production as a step.
A security review scored it 7/10 last session and it was recorded rather than
fixed, on the grounds that the branch is not deployed.

**What changed.**

- New optional env key `SEED_DEMO_PASSWORD` (min 8), alongside the existing
  `SEED_ADMIN_PASSWORD`.
- A new `resolvePasswords()` in `seed.ts` decides what the seeded accounts get:
  - Outside production, both keys fall back to `DEMO_PASSWORD` as before.
  - In production, both must be set, and neither may be `DEMO_PASSWORD`. The
    seed throws with a message naming the keys that are missing or reused.
- The doctors and patients now hash `passwords.demo` rather than the constant,
  and the returned credentials report it, so the printed sign-in block stays
  truthful whichever password was used.

**Decisions.**

- *A refusal, not a generated password.* Generating a random one in production
  would work, but it makes the operator read it out of a log they may not have
  kept, and a seed that silently invents credentials is harder to reason about
  than one that refuses until told what to use. `docs/DEPLOYMENT.md` now lists
  both keys in the pre-deploy checklist.
- *Development is untouched on purpose.* The well-known password is what keeps
  the project one command from something you can click through, and the demo
  accounts are `@medihelp.test`. The risk was only ever production.
- *Resolved before the first read or delete.* `resolvePasswords()` runs at the
  top of `seedDatabase()`, above the `countDocuments()` guard and well above the
  `deleteMany` block, so a production seed with no passwords set fails without
  having touched the database. A check asserts the user count is unchanged after
  a refusal.
- *Both keys, not one.* Setting only `SEED_ADMIN_PASSWORD` would still leave
  eight doctor accounts on a published password, which is a way in to every
  doctor-scoped route. The refusal names whichever key is missing.

**Files touched.** `server/src/config/env.ts`, `server/src/seed.ts`,
`.env.example`, `docs/DEPLOYMENT.md`, `server/scripts/check-seed.ts`.

**Verified.** `npm run check:seed` — 28 assertions, up from 19. The nine new ones
cover: production refused with no passwords, the refusal naming both keys,
nothing deleted by the refused run, refused with only the admin key set, refused
when a key is set to the repo's demo password, accepted once both are set, the
environment's admin password being the one that actually signs in, seeded doctors
carrying the environment's demo password and *not* the repo one, and development
still falling back. The check swaps `NODE_ENV` and the two keys around
`reloadSettings()` and restores them afterwards.

Note the check now clears `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` from the
environment twice — once before importing `seed.js` and once after. The import is
what runs `dotenv.config()`, and dotenv fills any key that is *absent*, so a
developer's own `.env` would otherwise decide what the check sees.

---

## `check-booking.ts` assumed a weekday

**The problem.** The suite failed before any of the above could be verified end
to end. `check-booking.ts` fixed its test day at today + 3 days; today is a
Wednesday, so that landed on a Saturday, the seeded doctors sit Monday to Friday
only, and `freeSlot()` crashed dereferencing `undefined`. Pre-existing — it fails
identically at `21700b1` — and precisely the trap the phase 6–7 handoff recorded
after `check-payments.ts` hit it.

**What changed.** `soonDate` is now found by `nextDayWithSlots()`, which scans
forward up to 21 days for the first date on which the doctor has an available
slot — the same shape as `freeSlot()` in `check-payments.ts`. `freeSlot()` in
this script now throws a message that says which day ran dry instead of
dereferencing `undefined`, so the next time a check books the day out the failure
names itself.

**Verified.** `check:booking` back to 81 assertions, zero failures.

---

## The code review of phases 6–7, and the seven fixes

Ran `/code-review high` over `77e0810~1..HEAD` — the seven commits covering the
public catalogue, slots, booking, payments and the seed gate above. Seven
findings, all fixed here. The two most serious were verified against the source
before acting on them.

### 1. Money kept for a cancelled appointment

`createOrder` refused a cancelled appointment; `verifyPayment` and
`confirmMockPayment` did not. The race: a patient opens checkout, the
appointment is cancelled in another tab or by the clinic while
`payment.status` is still `pending` — so `refundFor` saw nothing to refund and
returned — and the capture then lands and flips a cancelled appointment to
`paid`. The clinic keeps the money for a slot nobody holds, with nothing
flagging it.

**Decision: take the money, then hand it straight back.** Refusing the capture
in `verifyPayment` looked simpler but is worse — a valid signature means the
money is already at the gateway, and rejecting it leaves it sitting there with
nothing in our records pointing at it. So `settle()` now checks
`appointment.status === 'cancelled'` after recording the payment and refunds on
the spot, logging loudly. `settle` is the single choke point for both the
verify path and the webhook, so one guard covers both.

`confirmMockPayment` is the exception and refuses with a 409: the mock settles
synchronously on the button press, so nothing is ever in flight to hand back.

`verifyPayment` and `confirmMockPayment` now read the resulting status off the
appointment rather than returning a hardcoded `'paid'`, so a patient caught by
this is told `refunded` rather than told they have paid for a slot they lost.

### 2. "Refunded" shown for a refund that failed

`refundFor` swallows gateway errors on purpose — a gateway that will not refund
right now is a person's job, not a 500 for the patient who cancelled. But
`cancelAppointment` then wrote `payment.status = 'refunded'` unconditionally.
The log said "needs chasing by hand" while the patient's row and the UI both
said "Refunded", destroying the one signal that the money was still here.

`refundFor` now returns whether the money actually went back, and the caller
only writes `refunded` on true. A failed refund leaves the row saying `paid`,
which is both the truth and the thing that makes it findable.

The refund id also moved from `$push: { raw: { refundId } }` — which wrote an
array into a field documented as the gateway's raw object — to a proper
`gatewayRefundId` on the `Payment` schema.

### 3. An unauthenticated 500 on a malformed date

`slotQuerySchema` checked only `^\d{4}-\d{2}-\d{2}$`. `?date=2026-13-01` passed
that, parsed to an Invalid Date, and `day.toISOString()` threw a `RangeError`
out of the handler — a 500 for an anonymous caller. Reproduced in node before
fixing.

The quieter half of the same bug: `?date=2026-02-30` parses fine and rolls over
to 2 March, so the endpoint confidently answered about a day nobody asked
about. A new `isRealCalendarDay()` refine catches both by parsing and reading
the parts back — `new Date` alone rejects month 13 but accepts 30 February.

### 4. A same-length non-hex id was a 500

`objectIdParamSchema` checked `.length(24)` only, so
`/api/doctors/zzzzzzzzzzzzzzzzzzzzzzzz` reached `new Types.ObjectId()` and threw
a `BSONError`, which `normalise()` in `middleware/error.ts` does not recognise
(it handles `MongooseError.CastError`). `slotsOn` escaped it only because
`findById` produces a proper CastError.

Both copies of the schema — `doctors/doctor.schema.ts` and
`admin/admin.schema.ts` — are now a hex regex. Fixed in both rather than one,
because the admin routes reach the same driver call by a different path.

### 5. A webhook could not match a superseded order

`createOrder` is deliberately repeatable, but it overwrites
`appointment.payment.orderId`, while `handleWebhook` looked the appointment up
by that field. If a patient abandons a checkout, starts a second, and the
*first* order then captures, the webhook found nothing, logged "an order we
have no appointment for" and returned `handled: false` — money taken,
appointment unpaid.

The lookup now goes through the `Payment` collection's `gatewayOrderId`, which
has a row for every order ever created, and falls back to the old appointment
query. `settle()` also writes back the order id that actually paid, so the
appointment records the right one rather than the last one started.

### 6. An optional detail could never be cleared

`updateMyProfile` on the client dropped any value equal to `''` before sending.
Combined with `draftFrom` mapping an unset field to `''`, a patient who cleared
their phone number or date of birth got a request without the field, a server
that changed nothing, the old value snapped back into the form — and "Saved."
shown at the same time.

**Decision: teach the server what "clear it" means, rather than teach the client
to hide the button.** An absent field means "not changed"; an empty one now
means "clear it", for the three fields that are optional on the account anyway.
`updatePatientSchema` accepts `''` for `phone`, `dob` and `gender`, and the
service unsets rather than storing a blank, so an absent field and a blank one
do not read differently downstream. The name is not optional and an empty one is
still a 422.

(Gender was the least affected of the three: `prefer_not_to_say` is a real enum
value, so there was always an option to pick — just no way back to unset.)

### 7. A failed slot fetch spun forever

`loadSlots` sets `setSlots(null)` up front and only assigns on success; the
render treats `null` as "Loading times…". On a failed fetch the patient saw an
error note *and* a permanent spinner. The catch now sets `[]`, which renders the
honest "No times on this day"; changing the day is the retry.

### Also fixed, from the review's minor notes

`Appointments.tsx` `onPay` did not reload on the error path, so a payment that
settled at the gateway but failed on the way back left "Pay now" on a paid row —
an invitation to pay twice. It now reloads in the catch as well. Ordered before
`setError`, not after: `load()` clears the error on success, so the other way
round would have wiped the very message being reported.

### New checks

`check:payments` 39 → 52 and `check:booking` 81 → 95. The new ones drive the
actual sequences rather than the units: cancel-then-capture ending `refunded`
with a `gatewayRefundId` on the row and the appointment still `cancelled`; the
mock refusing a cancelled appointment; two orders on one appointment with the
first one capturing and still settling; clearing and restoring all three
optional profile fields; and 422s for a non-hex id, month 13, day 32, 30
February, with a real leap day still accepted.

**Not fixed, deliberately.** `updatePatientSchema`'s `dob` has the same
roll-over looseness as finding 3 — `1994-02-30` would store as 2 March. It is
cosmetic on a birthday rather than a wrong answer to a question, and it is
outside the reviewed range, so it is noted here rather than changed.

---

## Suite state

Per script, all passing: env 12, tokens 17, models 13, errors 6, auth 26,
auth:http 28, ratelimit 5, seed 28, upload 21, admin 87, doctor 94, booking 95,
payments 52 — **484 assertions, zero failures**. `npm run typecheck` and
`npm run lint` both clean.

(Counting these by piping the whole suite into `grep -c` under-reports; loop per
script.)

---

## Open items

- Pushed at the end of the session, so nothing is unbacked any more.
- No patient, doctor or payment screen has been rendered in a browser yet.
- The Razorpay provider has still never spoken to Razorpay — deliberate, it needs
  the user's account.
- Not merged to `main`.
