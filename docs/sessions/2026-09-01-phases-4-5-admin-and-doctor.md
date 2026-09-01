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

---

## 4.4 — Doctor management

**What changed.** `GET /api/admin/doctors` (speciality filter, name/email
search, optional removed doctors), `GET /api/admin/doctors/:id`,
`PATCH /api/admin/doctors/:id` (multipart, optional new photo), and
`DELETE /api/admin/doctors/:id`, which deactivates rather than deletes.

**Decisions.**

- *Delete means deactivate.* The appointments have to outlive the doctor:
  patients keep a visit history, the revenue figures include consults this
  doctor did, and an audit trail pointing at a row that no longer exists is not
  a trail. Setting `User.isActive = false` stops the login and takes them off
  every list while leaving all of that intact.
- *Removal does not touch `Doctor.available`.* That field is the doctor's own
  switch for taking new bookings. Flipping it as a side effect of removal would
  mean a reinstated doctor comes back with a setting the admin silently changed
  for them.
- *Removal signs them out everywhere.* `logoutEverywhere` revokes the refresh
  tokens, so the session cannot be renewed. The access token they already hold
  keeps working until it expires — fifteen minutes at most — which is the
  standing trade for not hitting the database on every request.
- *Reinstating is `PATCH { isActive: true }`, not a second delete route.*
  Without it the admin panel would have a one-way door.
- *An edit changes only the fields it names.* Every assignment is guarded on
  `!== undefined`, so changing a fee cannot blank an address by omission. An
  edit naming nothing at all is a 422 rather than a silent no-op.
- *The search term is regex-escaped.* It goes into a `RegExp` for a
  case-insensitive contains-match, so an unescaped `.*` would quietly return
  every doctor. The check asserts that it returns none instead.
- *No client object ever becomes a filter.* The list is assembled from fields the
  schema already parsed and typed — the rule that stands in for `sanitizeFilter`
  being off (`docs/SYSTEM_DESIGN.md` §3).
- The list is one aggregation over `Doctor` with the account joined, because the
  filters straddle both collections: speciality lives on the profile, the name
  and email the admin searches by live on the account.

**Files.** `server/src/modules/admin/{admin.service,admin.controller,admin.routes,admin.schema}.ts`,
`shared/types.ts` (`AdminDoctorDto`), `server/scripts/check-admin.ts`.

**Verification.** `npm run check:admin --workspace server` — now 60 assertions,
all green. The soft-delete ones are the point: after a removal the account is
deactivated but present, the profile row is there, the appointment count is
unchanged, `available` is untouched, the doctor is off the default list but on
the `includeInactive` one, the login is refused, and a reinstate lets them back
in. Also asserts `.*` in the search box matches nothing.

---

## 4.5 — Appointments admin, and the shared appointment service

**What changed.** `server/src/modules/appointments/appointment.service.ts` — the
one place that knows who may cancel or complete an appointment and what those
actions do. On top of it: `GET /api/admin/appointments` (paginated, filtered by
status, doctor, patient and date range) and
`PATCH /api/admin/appointments/:id/{cancel,complete}`.

**Decisions.**

- *The rules live in one module because three roles share them.* Patients,
  doctors and admins all cancel; doctors and admins both complete. Written once
  per caller those rules drift — one screen forgets the cash settlement, another
  lets a week-old completed consult be cancelled. Each caller passes an `Actor`
  and the service decides.
- *Cancelling releases the slot without doing anything about it.* The unique
  index that prevents double booking is partial and covers only the active
  statuses, so moving a row to `cancelled` drops it out of the index and the slot
  is bookable again. One rule enforced by the database rather than two states to
  keep in step. The check proves it by inserting the same doctor and time
  afterwards and asserting no duplicate-key error.
- *Ownership is checked by looking the doctor up, not by trusting the request.*
  A doctor with a valid token can put another doctor's appointment id in the URL;
  `assertMayAct` loads their `Doctor` id and compares. Role checks alone would
  pass this.
- *Completing settles cash.* A cash payment is `pending_at_desk` from booking
  until someone confirms the patient turned up and paid, which is exactly the
  moment of completion. A card payment was settled by the gateway and is left
  alone.
- *Completing also updates the doctor's typical consult length*, since that is
  the event that produces the measurement. It is a rolling average rather than a
  true median: a real median needs the whole history on every completion, and
  this tracks the same signal closely enough for a wait estimate while staying
  one small write. Consults that read as under a minute or over four hours are
  ignored as clock problems rather than measurements. Only consults that were
  actually started count.
- *The count and the rows come from one `$facet`.* Two separate queries against a
  live collection will eventually render a total that disagrees with the rows
  next to it.
- *A date range's `to` is inclusive of its whole day.* The bound is the start of
  the following day, because otherwise `to: today` silently drops today — which
  is the query an admin makes most.
- *Payment fields are written with `set('payment.status', …)`.* Mongoose types a
  nested object as optional even where its fields are required, and the path form
  sidesteps that while being explicit that the change is tracked.
- Cancelling a paid consult flags it `refunded`. The `Payment` row and the real
  gateway refund are phase 7; this is the flag the screens read until then.

**Files.** `server/src/modules/appointments/appointment.service.ts`,
`server/src/modules/admin/{admin.service,admin.controller,admin.routes}.ts`,
`server/scripts/check-admin.ts`.

**Verification.** `npm run check:admin --workspace server` — now 87 assertions,
all green. Notable: paging returns disjoint rows with a total that matches
`countDocuments`; a single-day range includes that day; cancelling records who
and when and frees the slot; cancelling or completing twice is a 409; a completed
consult cannot be cancelled and a cancelled one cannot be completed; and
completing a cash consult moves the dashboard's revenue up by exactly its fee.

---

## 4.6 — Admin UI

**What changed.** The admin panel itself: a layout shell with a sidebar, the
dashboard with stat tiles and a latest-bookings table that can cancel, the
add-doctor form with an image preview, the doctor list with remove/reinstate,
and the paged appointments table with cancel and complete. Plus
`client/src/api/admin.ts` and a small shared `components/ui.tsx`.

Also `npm run dev:sandbox`, which runs the real server against a freshly seeded
in-memory replica set so the app can be opened in a browser without pointing it
at Atlas.

**Decisions.**

- *A layout route, not a component each page imports.* The sidebar renders once
  and survives navigation between sections.
- *Filters live in the URL, not in component state.* A filtered list can then be
  linked to — which is exactly what the add-doctor form does when it lands on the
  doctor it just created. Changing any filter also clears the page number, since
  page 4 of the old result set is rarely page 4 of the new one and is often past
  the end.
- *After an action, reload rather than patch the row.* Cancelling from the
  dashboard changes the tiles too; a screen that quietly disagrees with itself is
  worse than one extra request.
- *The object URL for the image preview is revoked.* It is a live handle into the
  page's memory, not a string — picking a few photos in a row leaks each one
  otherwise.
- *Remove is a DELETE, reinstate is a PATCH.* Two verbs for two meanings, rather
  than one endpoint that flips whatever it finds.
- *Tables scroll sideways rather than squash.* An appointment row carries a
  patient, a doctor, a time, a payment and a status; on a narrow screen a
  horizontal scroll loses less than columns wrapping into each other.
- *`dev:sandbox` runs under `tsx watch`*, so an edit reloads and reseeds. A
  sandbox quietly serving a schema the source no longer has is worse than one
  that resets — which cost a debugging round when a schema fix appeared not to
  work.

**Two bugs the type checker could not see**, both found by actually opening the
page — and neither reachable from the check scripts, which assert on status codes
rather than on what a person reads:

1. *Submitting the form with About empty showed "Invalid input: expected string,
   received undefined"* — zod's internal wording, written for a programmer and
   shown to a receptionist. The client drops empty fields rather than sending
   `""`, so a blank box arrives as **absent**, and the schema only had a message
   for the present-but-too-short case. Fixed with a `required()` helper that
   gives every mandatory text field a message for the missing case too.
2. *That message was styled as a grey hint, not an error.* The About field reused
   the hint paragraph for its error text, so the one field with a problem looked
   exactly like the fields without one.

**Files.** `client/src/api/admin.ts`, `client/src/components/ui.tsx`,
`client/src/pages/admin/{AdminLayout,Dashboard,AddDoctor,Doctors,Appointments}.tsx`,
`client/src/routes/router.tsx`, `server/src/modules/admin/admin.schema.ts`,
`server/scripts/dev-sandbox.ts`, `package.json`, `server/package.json`.

**Verification.** `npm run typecheck`, `npm run lint` and `npm run build` clean;
`check:admin` (87) and `check:upload` (21) still green.

Driven in a real browser against the sandbox — the first visual check this
project has ever had, and the open item the previous session's handoff flagged.
The phase 4 exit criterion was walked end to end: a doctor added through the form
appears in the doctor list, and then signs in with the password the admin typed
and lands on the doctor route. The dashboard tiles rendered against seeded data,
the login and doctor list screens were confirmed by eye, and the guards were seen
working (a signed-in doctor is bounced off `/login`).

**Still unlooked-at:** the appointments table. The phase 3 rate limiter cut the
session short after repeated sign-ins — which is the limiter behaving correctly,
not a fault. Its behaviour is covered by the check script; only its rendering is
unconfirmed.

---

## 5.1 — Doctor profile endpoints

**What changed.** A `doctors` module with `GET /api/doctor/profile` and
`PATCH /api/doctor/profile` (multipart, optional new photo), mounted at
`/api/doctor`.

**Decisions.**

- *There is no id in any of these routes.* The doctor being acted on is always
  the one the verified token belongs to, found by `userId`. Ownership is
  therefore a property of the query rather than a check bolted on after it —
  there is no id for anyone to swap for someone else's.
- *A doctor may change less than an admin may.* They set their own fee, hours,
  description, address and availability. They cannot touch their speciality,
  degree or years of experience: those are the clinic's claims about their
  credentials, and letting the account holder rewrite them would make the public
  listing self-certified. Those fields are simply absent from the schema, so
  `validate()` strips them — the check posts all three and asserts nothing moved.
- *Admins are refused here, not waved through.* These routes act on "whoever is
  signed in", and an admin has no doctor profile of their own. They manage
  doctors through `/api/admin/doctors`, where the target is named explicitly.
- *`workingHours` arrives as a JSON string.* The rest of the form is multipart,
  which has no agreed way to carry an array of objects; parsing it in the schema
  keeps that ugliness at the boundary.
- *A missing profile is a clear 404, not a null dereference.* It should be
  impossible — the account and the profile are written in one transaction — so if
  it happens it is a bug that deserves a message naming it.

**Files.** `shared/types.ts` (`DoctorProfileDto`, `WorkingHoursDto`),
`server/src/modules/doctors/{doctor.schema,doctor.service,doctor.controller,doctor.routes,doctor.mapper}.ts`,
`server/src/app.ts`, `server/scripts/check-doctor.ts`, `server/package.json`.

**Verification.** `npm run check:doctor --workspace server` — 19 assertions, all
green: the three guards, a doctor reading and editing only their own record, the
credential fields being ignored when smuggled in, and a second doctor's record
being untouched by the first one's edit.

---

## 5.2 — Availability validation

**What changed.** `server/src/utils/availability.ts` — one function that finds
everything wrong with a set of working hours — wired into the profile schema as a
`superRefine`.

**Decisions.**

- *This is refused at the boundary because of what depends on it.* Slot
  generation (phase 6) walks each window from start to end in slot-sized steps.
  It cannot tell a genuine overnight shift from a typo, and two overlapping
  windows produce the same slot twice — which then races the unique index and
  surfaces to a patient as a booking that mysteriously fails. Refusing the grid
  is far cheaper than either.
- *Touching windows are allowed.* 09:00–13:00 followed by 13:00–17:00 is one long
  day, not a clash. Only a genuine overlap is refused.
- *Every problem is reported at once, not just the first.* A doctor filling in a
  week's grid should be able to fix their whole Tuesday in one pass instead of
  resubmitting five times. Issues carry the row index as their path, so a form
  can mark the offending rows.
- *Validation lives in the schema, not the service.* A bad grid is then a 422
  with per-field messages like every other validation failure in the app, and it
  never reaches the database.
- *Overlaps are found by sorting each day's windows by start time.* Once ordered,
  a window can only clash with the one immediately before it — one pass per day
  rather than comparing every pair. The check asserts the same clash is caught
  whichever order it is submitted in.

**Files.** `server/src/utils/availability.ts`,
`server/src/modules/doctors/doctor.schema.ts`, `server/scripts/check-doctor.ts`.

**Verification.** `npm run check:doctor --workspace server` — now 35 assertions,
all green. The availability ones cover: a sensible grid saved and read back,
back-to-back sittings allowed, backwards and zero-length and too-short sittings
refused with the day named, overlaps caught in either submission order, the same
hours on different days allowed, two bad rows both reported, malformed times and
weekdays refused, unparseable JSON refused — and, after all of those, the stored
grid is still the last good one.

---

## 5.3 — The doctor's appointment list

**What changed.** `GET /api/doctor/appointments?when=today|upcoming|past|all`,
paged. Plus a small refactor of the shared appointment service that this needed.

**Decisions.**

- *The shared filter now takes instants, not ISO date strings.* The doctor's
  scopes are anchored to a moment; the admin's are whole days. Rather than have
  two overlapping ways to say *when*, the service takes `Date` bounds and the
  admin controller converts its `from`/`to` days into them — including the
  start-of-next-day trick for `to`, which now lives at the one caller that thinks
  in days rather than in the shared code.
- *Sort order is a caller's choice.* History reads newest-first; a list of what is
  still to come reads soonest-first. `order` defaults to newest, which is what
  every backward-looking caller wants, and the doctor's today/upcoming lists ask
  for soonest.
- *"Upcoming" starts at the beginning of today, not at this instant.* A doctor
  running twenty minutes late still needs the ten o'clock patient on screen at
  ten past ten. Anchoring to `now` would drop the patient sitting in front of
  them.
- *A named scope, not a free date range.* These are the three questions a doctor
  actually asks. A date picker would be more general and less useful.
- *The `doctorId` comes from their own record*, looked up by `userId` — never
  from the request. There is no id in the URL to tamper with.

**Files.** `server/src/modules/appointments/appointment.service.ts`,
`server/src/modules/admin/admin.controller.ts`,
`server/src/modules/doctors/{doctor.service,doctor.controller,doctor.routes,doctor.schema}.ts`,
`server/scripts/check-doctor.ts`.

**Verification.** `check:doctor` now 53 assertions, `check:admin` still 87, both
green — the admin suite is what confirms the filter refactor did not change its
behaviour. New assertions worth naming: another doctor's list shares no rows with
this one; `past` and `upcoming` between them account for every appointment
exactly once; `today`'s rows all appear in `upcoming`; past is newest-first and
upcoming is soonest-first; and every row carries the patient's name and age.

---

## 5.4 — Doctor actions

**What changed.** `PATCH /api/doctor/appointments/:id/{start,complete,cancel}`,
and a new `startConsult` in the shared appointment service.

**Decisions.**

- *The actions are re-exported from the shared service, not reimplemented.* Who
  may act on what, and what completing does to a cash payment, are the same rules
  the admin panel obeys. The doctor's `Actor` carries `role: 'doctor'`, and the
  shared `assertMayAct` looks up their own `Doctor` id and compares it with the
  appointment's — so the trespass case is refused in one place rather than two.
- *`startConsult` closes a gap left open in 4.5.* Completing an appointment
  learns the doctor's typical consult length from `consultStartedAt`, but until
  now nothing ever set that field: the learning code could never fire and the
  queue's wait estimate would have sat on its default forever. Starting a consult
  is what stamps it.
- *Starting twice is a no-op, not a conflict.* A doctor who taps the button again
  has done nothing wrong, and moving the start time later would quietly shorten
  the consult being measured. The first stamp wins.
- *An implausible length is discarded rather than learned from.* A consult
  reading as thirty hours is a forgotten "start", not data. The check backdates
  one and asserts the doctor's median does not move.

**Files.** `server/src/modules/appointments/appointment.service.ts`,
`server/src/modules/doctors/{doctor.service,doctor.controller,doctor.routes,doctor.schema}.ts`,
`server/scripts/check-doctor.ts`.

**Verification.** `check:doctor` now 74 assertions, `check:admin` still 87, both
green. The ownership assertions are the point of the substep: with a valid
doctor token, completing, cancelling *and* starting another doctor's appointment
are each 403, and the target row is confirmed unchanged afterwards. Also: a
consult driven start → complete settles its cash payment, stamps both times,
moves the doctor's typical length toward the measured one, and then refuses to be
completed, cancelled or restarted.

One check-script fix worth noting: it originally hunted the seed for a booked
*cash* appointment of this doctor's. Which seeded row happens to be cash is an
accident of the seed's ordering, so the script now sets up that condition itself.

---

## 5.5 — Earnings

**What changed.** `GET /api/doctor/earnings` — total collected, this month's
share, completed consults, and distinct patients seen — in one `$facet`
aggregation.

**Decisions.**

- *Completed **and** paid, both conditions.* Completed alone would count a
  consult the patient walked out of without paying; paid alone would count a card
  payment for a booking that was later cancelled and refunded. Neither is money
  the doctor earned, and the check asserts both cases are excluded.
- *The amount comes from the appointment's frozen `amount`, not the doctor's
  current fee.* Otherwise raising the fee today would silently rewrite what every
  past consult was worth — the same reason `docSnapshot` exists.
- *"Patients" means distinct people, not consults.* Someone seen monthly all year
  is one patient. Grouping by `patientId` before counting is what makes that
  true; the check asserts the patient count never exceeds the consult count.
- *One aggregation, like the admin dashboard*, for a tile row that loads on every
  visit to the doctor's home page.

**Files.** `shared/types.ts` (`DoctorEarningsDto`),
`server/src/modules/doctors/{doctor.service,doctor.controller,doctor.routes}.ts`,
`server/scripts/check-doctor.ts`.

**Verification.** `check:doctor` now 91 assertions, all green; `check:admin` (87)
and `check:upload` (21) unchanged. `typecheck`, `lint` and `build` clean.

**The phase 5 exit criterion is asserted directly:** completing one appointment
raises the earnings total by exactly its fee and the consult count by exactly
one. That check creates its own appointment rather than borrowing one from the
seed — by the time it runs, the 5.4 block has completed or cancelled everything
of this doctor's that was still open, so a check hunting for a leftover booking
**silently skipped itself**, which is worse than failing because it reads as a
pass. Two neighbouring assertions had the same weakness and were rewritten; one
of them had been comparing the same API call against itself and could never have
failed.

The other half of the exit criterion — a doctor cannot act on another doctor's
appointment even by editing the id in the URL — is asserted in 5.4 for all three
actions.

---

## 5.6 — the doctor UI

**What changed.** `/doctor` stopped being a placeholder. It is now a layout route
with three screens: the day view (earnings tiles and today's list), the full
appointment book in four slices, and a profile editor with the clinic-hours grid.
A signed-in doctor also has a sign-out button for the first time.

**Decisions.**

- *The doctor shell is the admin shell, deliberately.* Same header, same sidebar,
  same active-link treatment — three sections instead of four. Two dashboards in
  one app that navigate differently is a thing a user has to learn twice.
- *One `AppointmentTable`, shared by the day view and the book.* The two screens
  differ in which appointments they ask for, not in what a row looks like or what
  a doctor may do to it. The action rules live in one place with them.
- *An action reloads the screen rather than patching the row.* Completing a
  consult also moves the earnings tiles and can drop the row out of the slice
  being shown; a screen that quietly disagrees with itself is worse than one
  extra request. That is `useAppointmentActions`, shared by both screens.
- *"Start" is hidden on a consult already in progress.* The server would accept
  it as a no-op, but offering it makes the row dishonest about what is left to do.
- *The slice and page live in the URL.* A doctor who reloads the tab, or keeps
  last week's list open in a second one, gets back what they were looking at.
- *The profile editor is narrower than the admin's form, by design.* Speciality,
  degree and experience are shown but not editable — they are the clinic's claims
  about a doctor's credentials, and letting the account holder rewrite them would
  make the public listing self-certified. Fee, hours, photo and description are
  the doctor's own. This mirrors what `updateProfileSchema` already allows; the
  form does not decide it.
- *Clinic hours are a list of sittings, not a week-long grid of cells.* A morning
  clinic and an evening one with a gap between them is the normal case, and it is
  exactly what slot generation walks. A row per sitting says that in one click;
  a grid of half-hour checkboxes would say it in forty-eight.
- *The grid validates nothing itself.* Overlaps and backwards windows are the
  server's answer, returned per row as `workingHours.<index>`; the component's
  only job is putting each message back on the row it came from and reddening it.
  A second copy of those rules in the client is a second thing to get wrong.
- *Rows are keyed by index on purpose.* They have no id of their own, and the
  server addresses them by position too. Editing is what happens here; reordering
  is not.
- *After a save, the form resets from the response, not the draft.* The server
  trims, coerces, and may have stored a different photo URL than the one just
  uploaded.

**Files.** New: `client/src/api/doctor.ts`,
`client/src/pages/doctor/{DoctorLayout,Dashboard,Appointments,Profile,AppointmentTable,AvailabilityGrid}.tsx`,
`client/src/pages/doctor/useAppointmentActions.ts`. Changed:
`client/src/routes/router.tsx`, `docs/PHASES.md`.

**Verification.** `typecheck`, `lint` and `build` all clean. The full server
check suite re-run at 325 assertions, all green — 5.6 touched no server file, so
this confirms the contracts the new screens call are the ones that were already
proven. Both phase 5 exit criteria are asserted server-side in 5.4 and 5.5 and
are unchanged.

**Still to be looked at by a human.** Every doctor screen is new and none has been
rendered in a browser. The admin appointments table is still unviewed from the
previous batch.
