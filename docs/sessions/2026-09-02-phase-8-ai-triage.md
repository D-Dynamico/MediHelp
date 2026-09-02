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
