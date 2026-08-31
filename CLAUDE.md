# MediHelp — Claude Guide

## Session Protocol (READ FIRST — keep the project's memory rich)

This repo keeps a durable, written memory so every session starts with full context.
You must maintain it — it is not optional:

- At the start of a session, skim the newest file in `docs/sessions/` (and this file).
  That is where the last session recorded what changed, why, and what's still open.
  `docs/SYSTEM_DESIGN.md` is the deep architecture + workflow reference.
- After each successful, behavior-changing task, update the running session note
  `docs/sessions/<YYYY-MM-DD>-<topic>.md` (create it on the first such task of the
  session): what changed, why (the decision, not just the diff), files touched, and
  how you verified it. Trivial/no-op turns don't need an entry.
- At session end, make sure that session note is complete (scope, changes,
  verification, open items) and update any docs whose behavior changed —
  `README.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_DESIGN.md` — plus the
  auto-memory `MEMORY.md` index when something durable was learned.
- `.env` / settings changes don't take effect until the servers restart —
  `getSettings()` is cached (`reloadSettings()` exists for scripts/tests).
  Note this whenever you touch config.
- A Stop hook in `.claude/settings.local.json` prints a reminder of this protocol;
  the protocol itself lives here.

---

## What this project is

A hospital management system on the MERN stack with three roles — **admin**,
**doctor**, **patient** — secure JWT auth with refresh-token rotation, and three
features that lift it past tutorial-grade CRUD: AI symptom triage, a live
Socket.IO queue/token board, and an auto-waitlist that refills cancelled slots.

## Documentation map

Read the doc that matches the question. Don't duplicate their content here.

| Doc | What's in it |
|---|---|
| `docs/ARCHITECTURE.md` | Folder layout, stack choices, module boundaries, how client/server/shared fit together |
| `docs/SYSTEM_DESIGN.md` | Data models, indexes, auth & security design, the three flagship features in depth, API surface |
| `docs/WORKFLOW.md` | How to work in this repo: commit style, session notes, docs upkeep, verification habits |
| `docs/PHASES.md` | The build plan, phase by phase, with exit criteria for each |
| `docs/sessions/` | One note per working session — the running project memory |
| `README.md` | Setup and run instructions for a human |

## Stack at a glance

- **Server**: Node + Express 5, TypeScript, Mongoose (MongoDB Atlas), Socket.IO,
  zod validation, bcrypt, JWT, node-cron
- **Client**: Vite + React + TypeScript + Tailwind + React Router — a single app
  with role-guarded route groups
- **Shared**: `shared/types.ts` — role, status and DTO types imported by both sides

## Ground rules

- **Atlas is the only real external dependency.** Payments (Razorpay), image
  hosting and the AI provider all sit behind interfaces with keyless local
  fallbacks, so the project boots and demos with just `MONGODB_URI` set.
- **Never trust the client for money or identity.** Fees come from the doctor
  record on the server; roles come from the verified token, never the request body.
- **Role checks are not enough** — also check ownership (a doctor may only touch
  their own appointments).
- **Access tokens live in memory on the client**, never `localStorage`. Refresh
  tokens are httpOnly cookies with rotation and reuse detection.
- **Validate every request body with zod** at the route boundary.
- Secrets stay in `.env`; `.env.example` documents every key. Never commit real keys.
- Match the surrounding code's style, naming and comment density before inventing
  a new pattern.

## Commands

```bash
npm install         # root, installs client + server workspaces
npm run dev         # server on :4000, client on :5173
npm run seed        # seed admin, doctors, patients, sample appointments
npm run typecheck   # tsc --noEmit on both packages
npm run lint
```

## Commit style

Plain language, no jargon. Say what changed in words a non-engineer would follow —
e.g. `add doctor login and password reset`, not `feat(auth): impl RS256 rotation`.
Full rules in `docs/WORKFLOW.md`.
