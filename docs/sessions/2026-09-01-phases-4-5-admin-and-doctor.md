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

---

## 4.2 — Upload middleware and the storage providers

**What changed.** `uploadImage(field)` middleware built on multer, plus a
`providers/storage` interface with a local and a Cloudinary implementation
behind it. Locally stored files are served from `/uploads`.

**Decisions.**

- *`Content-Type` is a claim; the bytes are the fact.* The MIME check is a cheap
  first pass so an obviously wrong file never reaches memory, but what actually
  decides is the file's first twelve bytes. A PHP shell announced as
  `image/png` sails through a MIME check and is stopped only here. The check
  script uploads exactly that.
- *SVG is not accepted.* It is a document that can carry script, so an SVG
  stored and then served from our own origin is a cross-site scripting hole.
  JPEG, PNG and WebP only.
- *Files are held in memory, never a temp directory.* They are capped at 2 MB,
  and the destination may not be a disk at all — nothing should touch the
  filesystem before it has been checked.
- *The stored filename is a random UUID.* A client that controls the filename
  controls the extension and can overwrite someone else's file by reusing a
  name.
- *Cloudinary is written against `fetch` and `crypto`, not the SDK.* The SDK
  would be a hard install on every machine for a path that only runs in
  production. A signed upload is one SHA-1 over the sorted parameters plus the
  secret — not worth a dependency.
- *A misconfigured Cloudinary warns rather than falls back quietly.* Silently
  writing to the local disk in production means the images vanish on the next
  deploy, and nobody finds out until a user does.
- Multer's own error messages are for developers ("File too large"); they are
  translated into ones aimed at whoever is filling in the form.

**Files.** `server/src/middleware/upload.ts`,
`server/src/providers/storage/{index,local,cloudinary}.ts`,
`server/src/types/express.d.ts`, `server/src/app.ts`,
`server/scripts/check-upload.ts`, `server/package.json` (multer,
`@types/multer`, `check:upload`).

**Verification.** `npm run check:upload --workspace server` — 21 assertions, all
green, posting real multipart bodies at a real route: each accepted format, a
script renamed to `.png` with a PNG content type, an SVG, an oversized file, a
file in the wrong field, and a request with no file at all. Also asserts the
bytes on disk match what was sent and that the stored name is not the uploaded
one. `npm run typecheck` and `npm run lint` clean.

---

## 4.3 — Add doctor

**What changed.** `POST /api/admin/doctors`, multipart, creating the `User` and
the `Doctor` in one transaction. Plus `admin.schema.ts`, which is where the
admin module's request shapes now live, and a doctor mapper shared with the
public and doctor-facing modules to come.

**Decisions.**

- *One transaction, because the half-made state is genuinely bad.* If the
  `Doctor` write fails after the `User` write, what is left is an account that
  can log in, has the doctor role, has no profile — so the doctor dashboard has
  nothing to render — and holds the email address hostage against a retry. The
  check script forces exactly that failure and asserts the account is gone.
- *Multipart means every field arrives as a string.* `fees` comes in as `"500"`,
  `available` as `"true"`. The zod schema is the one place that becomes typed
  data; nothing downstream re-parses strings.
- *Speciality is an enum, not free text.* It drives the public filter and, later,
  triage routing — a typo would make a doctor unfindable rather than
  mis-labelled.
- *The address is flat on the wire* (`addressLine1`, `addressLine2`) and nested
  in the model. Nested objects through multipart are a bracket-notation
  convention no form library agrees on.
- *A stranded upload is cleaned up in the error handler.* The image is stored
  before the handler runs, so a rejected field, a taken email or an aborted
  transaction would each leave a file with nothing pointing at it. Every one of
  those paths ends at `errorHandler`, so that is where the file is reclaimed —
  one place rather than one per failure mode. The controller clears the marker
  on success so a later error cannot delete a live doctor's photo.
- *The duplicate email is checked before the transaction opens*, so the common
  mistake gets a clear 409 instead of a duplicate-key error surfacing out of an
  aborted transaction.
- The upload middleware runs *before* validation, because until multer has read
  the multipart body there are no fields for the schema to look at.

**Files.** `server/src/modules/admin/{admin.schema,admin.service,admin.controller,admin.routes}.ts`,
`server/src/modules/doctors/doctor.mapper.ts`, `server/src/middleware/error.ts`,
`server/scripts/check-admin.ts`.

**Verification.** `npm run check:admin --workspace server` — 31 assertions, all
green. The ones that matter: a doctor added through the endpoint logs in with the
password the admin typed and comes back with the doctor role; a forced failure of
the second write leaves no account and frees the email again; a refused create
leaves no file in the upload directory; and the returned `id` is the `Doctor` id,
not the `User` id.
