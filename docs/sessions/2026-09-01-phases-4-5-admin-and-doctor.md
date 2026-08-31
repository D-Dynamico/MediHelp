# 2026-09-01 — Phases 4 and 5: admin panel and doctor dashboard

Scope for the session: build phase 4 (admin panel) and phase 5 (doctor
dashboard) end to end, one commit per substep, and fix the stale progress line in
`README.md`. Push the branch when phase 5 lands.

Starting point: branch `phases-1-3-foundation`, phases 1–3 done and verified.

---

## README progress line

`README.md` still announced "phase 1 of 13 complete" after phases 2 and 3 had
landed. Rewritten to say phase 3 and to name what actually works now, so the
first thing a reader sees is not two phases out of date.

---

## 4.1 — Dashboard stats

**What changed.** A new `admin` module — service, controller, router — mounted at
`/api/admin` inside `createApp()`, above `notFound`. `GET /api/admin/dashboard`
returns the doctor, patient and appointment counts, revenue, today's upcoming
count, and the five newest bookings.

**Decisions.**

- *One aggregation, not five queries.* `$facet` answers the four
  appointment-shaped questions in a single pass over the collection, and a
  `$lookup` after it adds the head-count from `users`. The facet has already
  collapsed the stream to one document by the time the lookup runs, so it
  executes once rather than per row. This screen loads on every admin page view;
  five round trips to Atlas for it would be five too many.
- *Revenue means collected.* Only `payment.status: 'paid'` counts. A booked but
  unpaid consult is not money the clinic has.
- *Counts exclude soft-deleted accounts* (`isActive: true`). The tiles answer
  "how many people does the clinic have", not "how many has it ever had".
- *Guards on the router, not the routes.* `adminRouter.use(requireAuth,
  requireRole('admin'))` means a route added later cannot be left unguarded by
  forgetting to repeat the middleware.
- *The doctor on an appointment card is read from `docSnapshot`, never joined.*
  The snapshot is what the appointment was booked at; joining would rewrite the
  price and speciality of every past appointment the next time a doctor edits
  their profile. The patient *is* joined — a name is not worth freezing, because
  people correct their spelling and expect to see the correction.
- A deleted patient must not make their appointment disappear from the admin's
  table, so the patient `$unwind` preserves empty arrays and the mapper falls
  back to "Deleted patient".

**Files.** `shared/types.ts` (`AdminDashboardDto`), `server/src/utils/dates.ts`,
`server/src/modules/appointments/appointment.mapper.ts`,
`server/src/modules/admin/{admin.service,admin.controller,admin.routes}.ts`,
`server/src/app.ts`, `server/scripts/check-admin.ts`, `server/package.json`.

**Verification.** `npm run check:admin --workspace server` — 12 assertions, all
green. It seeds a throwaway database and then compares every tile against a
`countDocuments`/`aggregate` run separately, so the dashboard is checked against
rows that exist rather than against a fixture. Also asserts 401 without a token
and 403 for a patient. `npm run typecheck` and `npm run lint` clean.

The check script uses `MongoMemoryReplSet`, not `MongoMemoryServer`: 4.3 creates
the `User` and `Doctor` in one transaction, and transactions need a replica set.
Verified a single-node replica set starts and commits a transaction here before
relying on it.
