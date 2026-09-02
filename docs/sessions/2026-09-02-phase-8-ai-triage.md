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
