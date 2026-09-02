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

## Suite state

Per script, all passing: env 12, tokens 17, models 13, errors 6, auth 26,
auth:http 28, ratelimit 5, seed 28, upload 21, admin 87, doctor 94, booking 81,
payments 39 — **457 assertions, zero failures**. `npm run typecheck` and
`npm run lint` both clean.

(Counting these by piping the whole suite into `grep -c` under-reports; loop per
script.)

---

## Open items

- Five commits were unpushed at the start of the session; this one adds to them.
- No patient, doctor or payment screen has been rendered in a browser yet.
- The Razorpay provider has still never spoken to Razorpay — deliberate, it needs
  the user's account.
- Not merged to `main`.
