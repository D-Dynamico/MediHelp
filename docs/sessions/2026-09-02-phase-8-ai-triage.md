# 2026-09-02 — Phase 8: AI symptom triage

Scope: build phase 8 end to end, one commit per substep. Branch
`phase-8-ai-triage`, cut from `main` at `7b26927` (phases 1–7, merged earlier
today).

The design is `docs/SYSTEM_DESIGN.md` §5; the substeps and exit criteria are in
`docs/PHASES.md`. Shape of the phase: a deterministic offline engine first, then
Claude as an optional upgrade behind `ANTHROPIC_API_KEY`, then the link into
booking, the UI, and the disclaimer.

---

## 8.1 — The rules engine

**What changed.** New `server/src/providers/ai/rules.ts`: a pure, synchronous,
dependency-free `assessWithRules()` that turns free-text symptoms into
`{urgency, recommendedSpeciality, intakeNote, questionsToAsk, structured}`.

**Decisions.**

- *Red flags take combinations, not single words.* Each entry is a list of
  groups; every group must match, any phrase within one will do. Chest pain
  *with* breathlessness is an emergency; chest pain alone is `urgent` and routes
  to the cardiologist. Treating either half as an emergency on its own would
  raise the banner often enough that people learn to ignore it, which is worse
  than not having one. A flag needing no second half simply has one group.
- *Whole-word matching.* The short keywords would otherwise fire inside longer
  words — "rash" in "harsh", "fits" in "benefits". `mentions()` wraps each
  phrase in non-letter boundaries rather than using `\b`, so multi-word phrases
  work too. A check covers the "harsh" case specifically.
- *Specialities are scored by matched phrase length, not hit count.* "period
  pain" should beat a generic mention rather than tie with it. Ties fall to the
  order of `SPECIALITIES`, which puts the general physician first — the right
  way for a tie to break when the clinic is guessing. Nothing recognised at all
  still returns General physician, because the UI needs something bookable.
- *No speciality on an emergency.* Offering a department to book next to "call
  an ambulance" is a mixed message, and the banner replaces the form anyway.
  `recommendedSpeciality` is deliberately absent there.
- *Duration is read back as words, not parsed into days.* "a few weeks" is
  useful to the doctor exactly as the patient said it; turning it into a number
  would invent precision nobody gave. `NUMBER_WORDS` handles "three days" and
  "a couple of days" alike.
- *Every note says it was written by keyword rules and is not a diagnosis.* The
  disclaimer starts here rather than being bolted on in 8.6, because the note is
  the part a doctor reads later, out of the context of any screen.
- *Self-harm is a red flag whose advice points at a person*, not at a booking
  and not at an ambulance alone.

**Files touched.** `server/src/providers/ai/rules.ts` (new),
`server/scripts/check-triage.ts` (new), `server/package.json`.

**Verified.** `npm run check:triage` — 36 assertions, zero failures, including
both of the phase's stated exit cases: "crushing chest pain and short of breath"
is `emergency` with no speciality, and "itchy rash for three days" is `routine`
and Dermatologist. Also covers each other red flag, the half-a-red-flag cases,
whole-word matching, all eight routing targets, severity, duration parsing, and
that the engine is deterministic — which is what makes it usable as the fallback
for an engine allowed to fail.

---

## 8.2 — The triage service and route

**What changed.** A new `triage` module — schema, service, controller, router —
mounted at `/api/triage` in `createApp()`. `POST /api/triage` assesses free text
and persists a `TriageAssessment`; `GET /api/triage/:id` reads one back. A new
`TriageDto` in `shared/types.ts` is what both sides speak.

**Decisions.**

- *Signed-in patients only.* It could have been open — the rules engine needs no
  account — but every assessment is stored against a person and will be linked
  from an appointment in 8.4. An anonymous pile of symptom text with nobody to
  own it is a liability, not a feature. Doctors and admins get a 403: this is the
  patient's own surface, and a doctor reads the note through the appointment.
- *Ownership, not just the role.* `getOwn` checks the patient id on the record,
  and a stranger's assessment is a **404, not a 403** — a 403 would confirm the
  record exists to someone with no business knowing that. This is the most
  personal thing the app stores.
- *The audit entry carries the id, urgency and engine — never the symptom text.*
  Admins browse the audit log; what a patient wrote about their own body is not
  theirs to read in passing. The id points at the record for anyone with an
  actual reason to open it. A check asserts the text is absent from the log.
- *`emergencyAdvice` is derived on the way out, not stored.* It is a property of
  the matched red flag, and wording that a clinic may want to change should not
  need a migration of every historical row. The DTO computes it from
  `structured.redFlags` through `emergencyAdviceFor()`.
- *A too-long description is a 422, not a silent truncation.* Cutting a patient's
  description in half and assessing the remainder is worse than asking them to
  summarise. The ceiling matches the model's `maxlength`.
- *Its own id schema.* `triageIdParamSchema` is a hex regex from the start, for
  the reason found in the phases 6–7 review: a same-length non-hex id otherwise
  reaches the driver and becomes a 500.

**Files touched.** `server/src/modules/triage/{triage.schema,triage.service,triage.controller,triage.routes}.ts`
(new), `server/src/app.ts`, `shared/types.ts`, `server/scripts/check-triage.ts`,
`docs/SYSTEM_DESIGN.md` §8.

**Verified.** `npm run check:triage` — 61 assertions, up from 36. The new ones
drive the real route: the three guards, the three validation floors and ceiling,
the happy path and its persisted row, reading it back, the three ownership cases
(another patient, unknown id, malformed id), the emergency over HTTP, and that
the audit entry exists without the symptom text in it.

One trap worth recording: `AuditLog.targetId` is an `ObjectId` on the schema, so
a check querying the raw collection with the id **as a string** silently matches
nothing. It read as a missing audit entry rather than a type mismatch.

---

## 8.3 — The Claude engine

**What changed.** `@anthropic-ai/sdk` added to the server workspace. New
`providers/ai/llm.ts` (the Claude call) and `providers/ai/index.ts` (which
engine, and the fallback). The triage service now calls `assessSymptoms()`
rather than the rules directly.

**The `claude-api` skill was loaded before writing any of this**, per the
handoff's standing instruction. What it changed versus writing from memory:

- `budget_tokens` is gone on current models — adaptive thinking replaces it.
  Left at the model's default rather than configured.
- Structured output goes in `output_config: { format: ... }`; the older
  top-level `output_format` is deprecated.
- `TRIAGE_MODEL` now defaults to **`claude-opus-5`**, not the
  `claude-sonnet-5` placeholder the phase-1 scaffolding shipped. The skill is
  explicit that Opus 5 is the default unless the user names another model; the
  old value was a scaffolding guess, not a decision. `.env.example` updated to
  match. **Flagged for the user** — it is a cost-relevant default and easy to
  change back in `.env`.

**Decisions.**

- *An upgrade, never a dependency.* `assessWithClaude` throws on everything —
  timeout, rate limit, refusal, malformed JSON — and `assessSymptoms` catches
  the lot and answers from the rules with `source: 'rules'`. The booking flow
  is never blocked on a network call.
- *Warn, not error, on fallback.* The patient still gets an answer; a clinic
  whose key expired should see it in the logs without being paged.
- *Deliberately unlike the payment provider.* That one shouts at startup when it
  is chosen but unconfigured, because falling back silently would take real
  money. Here the fallback **is** the design: the rules answer every input, so a
  failure costs quality rather than correctness.
- *The schema is the request; the zod parse is the trust boundary.* Structured
  outputs constrain generation but are not a promise. A speciality this clinic
  does not employ, or an urgency outside the three we know, has to fall to the
  rules rather than reach the database.
- *An emergency never carries a speciality — enforced, not trusted.* The model
  is told to return null there, and the code overrides it regardless.
- *`maxRetries: 0` on the client.* The SDK's default of 2 would multiply the
  wall clock by three against a hard deadline, spending a waiting patient's time
  on a call we are willing to abandon.
- *`effort: 'low'`.* This is a short classification behind an 8-second deadline.
- *Every note says which engine wrote it.* The rules note says "keyword rules";
  the Claude note appends "Assessed by an AI assistant, not a clinician."

**Files touched.** `server/src/providers/ai/{llm,index}.ts` (new),
`server/src/modules/triage/triage.service.ts`, `server/src/config/env.ts`,
`.env.example`, `server/package.json`, `server/scripts/check-triage.ts`.

**Verified.** `npm run check:triage` — 69 assertions, up from 61. The eight new
ones cover the phase's second exit criterion directly: with no key, Claude is
not in play, `source` is `rules`, no model is recorded, and the answer is
**byte-identical** to calling the rules engine. Then, with a key set that cannot
work, the call really is attempted and really does fail, and the patient still
gets the rules answer — including the emergency case. That proves the fallback
end to end without a real account.

**Open item, deliberate.** The Claude path has **never spoken to the real API** —
same standing caveat as the Razorpay provider. The request shape follows the
`claude-api` skill and the response is parsed defensively, but only a run with a
real `ANTHROPIC_API_KEY` will confirm the round trip. Left because it needs the
user's account.

---

## 8.4 — The link into booking

**What changed.** `triageId` now actually reaches the doctor. A
`triageLookupStages` join in the appointment mapper projects the assessment's
urgency and intake note onto every appointment row; `AppointmentDto` gains
`intakeNote` beside the `urgency` it already had; the doctor's table renders an
urgency chip and a collapsed "Before the consult" note.

**A real hole closed on the way.** Booking has accepted and stored `triageId`
since phase 6, and **never checked whose assessment it was**. Any patient could
have attached another patient's assessment id to their own booking, and the
doctor would have read that person's symptoms as belonging to the patient in
front of them. `bookAppointment` now loads the assessment and compares its
`patientId` — a 404, not a 403, matching `getOwn`. This was not in the phase
plan; it was found while wiring the link up.

**Decisions.**

- *The join projects only urgency and the note — never `symptomsText`.* The
  doctor reads the summary written for them. The raw text stays in the
  assessment, and the admin's table (which shares the mapper) has no business
  with either, but shows what it is given, so the projection is the control.
- *The lookup lives in the shared mapper, not in the doctor's query.* Every
  list in the app renders the same card through `toAppointmentDto`; a join in
  one caller would mean a chip that appears on one screen and not another.
- *`urgency` reads from the joined assessment, not from a column.* The row type
  previously declared `urgency?` and nothing ever populated it — it was a field
  waiting for this substep.
- *The note is a `<details>`, not always-on text.* Most rows have no note, and
  an open one on every row would push the day off the screen. One click, on the
  row the doctor is already reading.
- *An urgency chip for `emergency` is rendered even though triage refuses to
  offer a booking form for one.* A patient can book first and be assessed
  afterwards, so the case is drawn rather than assumed away.
- *`doctorId` and `triageId` in the booking schema are now hex regexes*, for the
  reason the phases 6–7 review established — length alone lets a non-hex id
  reach the driver and become a 500.

**Files touched.** `server/src/modules/appointments/{appointment.mapper,appointment.service,appointment.schema}.ts`,
`server/src/modules/admin/admin.service.ts`, `shared/types.ts`,
`client/src/components/ui.tsx`, `client/src/pages/doctor/AppointmentTable.tsx`,
`server/scripts/check-triage.ts`.

**Verified.** `npm run check:triage` — 83 assertions, up from 69. The new ones
book with an assessment attached and then read the doctor's own list back to
confirm the urgency and note arrive there; check a booking without one still
works and carries neither; and cover the hole directly — another patient's
assessment id is refused, an unknown one is refused, a non-hex one is a 422 not
a 500, and none of the three books anything. `check:booking` (95),
`check:admin` (87), `check:doctor` (94) and `check:payments` (52) all still pass
unchanged, which is what says the shared mapper change broke nothing.

---

## 8.5 — The triage UI

**What changed.** A new `/triage` page for signed-in patients: a description
box, an optional "how long", and a result card. A new `api/triage.ts`. The
catalogue and the doctor's page now carry an assessment id through to the
booking. A "Check symptoms" link in the patient nav, and a "Not sure which kind
of doctor you need?" prompt on the catalogue for everyone else.

**Decisions.**

- *An emergency is a different screen, not a result with a warning attached.*
  `TriageResult` returns early for `emergency` and renders a red card with the
  advice and the matched indicators — no speciality, no link to the catalogue,
  nothing that looks like a booking. The point of the answer is that it is not
  an appointment, so nothing on the screen should offer one.
- *The assessment id travels in the URL, not in router state.* `/triage` →
  `/?speciality=X&triage=<id>` → `/doctors/:id?triage=<id>` → the booking body.
  Router state would be lost on a refresh or a shared link; the URL survives
  both, and the catalogue already keeps its filters there for the same reason.
  The sign-in detour preserves it too, so booking after signing in still reaches
  the note.
- *The suggestion is a filter the patient can drop.* Arriving from triage shows a
  banner saying so, with "Show all doctors" beside it — and dropping the
  speciality keeps the assessment, so overriding the suggestion does not cost
  the doctor their note. There is also a "Browse all doctors instead" link on
  the result itself. A recommendation someone cannot ignore is a decision made
  for them.
- *A stale result is cleared when a new assessment fails.* Leaving the previous
  answer on screen beside an error about a newer one invites reading the old
  answer as the answer to what was just typed.
- *The submit button is disabled under ten characters* — the same floor the
  server enforces, so the common case is a disabled button rather than a 422.
- *Discoverability for signed-out visitors.* The nav entry is patient-only
  because the route is, but the catalogue's prompt points anyone at it; the
  route guard sends them through login and back.

**Files touched.** `client/src/pages/patient/Triage.tsx`,
`client/src/api/triage.ts` (both new), `client/src/routes/router.tsx`,
`client/src/pages/public/{SiteLayout,Doctors,DoctorDetail}.tsx`.

**Verified.** `npm run typecheck`, `npm run lint` and `npm run build` all clean.
The server-side link is already covered by the 8.4 checks — booking with a
`triageId` and reading the doctor's row back. **Nothing here has been clicked in
a browser**, in line with the standing preference; see the open items.
