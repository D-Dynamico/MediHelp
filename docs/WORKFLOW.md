# Working in this repo

How we work day to day: commits, session notes, docs upkeep, and what "done" means.

---

## Commit style

**Write commit messages in plain language.** Someone non-technical should be able
to read the log and follow what happened to the product. No conventional-commit
prefixes, no ticket codes, no acronyms, no framework jargon in the subject line.

Rules:

- Subject line: lowercase, under ~70 characters, present tense, says what changed.
- Describe the **change to the product**, not the mechanics of the code.
- One commit = one coherent change. Don't bundle unrelated work.
- Add a body only when the *why* isn't obvious from the subject. Wrap at 72 chars.
- Never commit `.env`, real API keys, `node_modules`, or `uploads/` contents.

Good:

```
add login and signup for patients
show earnings total on the doctor dashboard
let admin cancel a booking from the dashboard
fix wrong time shown on appointment cards
free up the slot when a booking is cancelled
```

Avoid:

```
feat(auth): implement JWT RS256 rotation w/ reuse detection
refactor: DRY up appointment service layer
chore: bump deps
fix bug
WIP
```

When a body helps:

```
offer a cancelled slot to the next person waiting

Slots freed by a cancellation used to just disappear from the day.
Now the first person on the waitlist gets a 10 minute window to claim
the slot, and it passes down the list if they don't.
```

---

## Session notes — the project's memory

`docs/sessions/` is the running log. One file per working session:
`docs/sessions/<YYYY-MM-DD>-<topic>.md`.

Create it on the first behavior-changing task of the session, then keep appending
to the same file. Trivial turns (a question answered, a file read, a typo) need no
entry.

Template:

```markdown
# 2026-08-31 — Auth and admin dashboard

## Scope
What this session set out to do.

## Changes
- What changed, and **why** — the decision behind it, not a restatement of the diff.
- Files touched.

## Verification
How it was actually checked: commands run, what the output showed, what was
clicked in the browser.

## Open items
What's unfinished, known-broken, or deliberately deferred, and why.
```

The **why** is the part that matters. A diff can be read from git; the reasoning
behind a decision cannot.

---

## Docs upkeep

When behavior changes, the docs change in the same session:

| If you changed... | Update... |
|---|---|
| Folder layout, a new module, a stack choice | `docs/ARCHITECTURE.md` |
| A data model, index, auth rule, or how a flagship feature works | `docs/SYSTEM_DESIGN.md` |
| Setup steps, env vars, run commands | `README.md` and `.env.example` |
| How we work | this file |
| Anything durable worth remembering across projects | the auto-memory `MEMORY.md` index |

Phase completion gets ticked off in `docs/PHASES.md`.

---

## Config and restarts

`.env` and settings changes **do not take effect until the servers restart** —
`getSettings()` caches the parsed config on first read (`reloadSettings()` exists
for scripts and tests). Whenever you touch config, say so in the session note and
tell the user to restart.

---

## Definition of done

A task is done when all of these are true:

1. It works — verified by actually running it, not by reading the code.
2. `npm run typecheck` and `npm run lint` pass.
3. Inputs are validated, and the route is guarded by both role **and** ownership
   where ownership applies.
4. The session note records what changed, why, and how it was verified.
5. Any doc whose behavior changed has been updated.

## Verification habits

- Prefer running the real thing over asserting it works. Hit the API with `curl`,
  click through the UI, watch the two-browser socket test for realtime work.
- Report honestly. If something failed or was skipped, say so plainly with the
  output — never round a partial result up to "done".
