# MediHelp

A hospital management system on the MERN stack with three roles — **admin**,
**doctor** and **patient** — secure JWT authentication, appointment booking and
payments, plus three features that go past the usual CRUD app:

- **AI symptom triage** — describe symptoms in plain language, get an urgency
  level, the right specialty, and a structured note the doctor reads before the
  consult.
- **Live queue and token board** — real-time position and wait estimate for every
  patient, built from the doctor's actual consult times.
- **Auto-waitlist** — a cancelled slot is offered automatically to the next person
  waiting, with a claim window, so it never goes to waste.

> Not built yet — the repo currently holds the plan and docs. Build order is in
> `docs/PHASES.md`.

## Documentation

| Doc | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Session protocol and ground rules |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Folder layout, stack, module boundaries |
| [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | Data models, auth and security, the three features, API surface |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | Commit style, session notes, definition of done |
| [`docs/PHASES.md`](docs/PHASES.md) | Build plan, phase by phase |
| [`docs/sessions/`](docs/sessions/) | Running log of what changed and why |

## Stack

React + TypeScript + Tailwind (Vite) · Node + Express 5 + TypeScript ·
MongoDB Atlas (Mongoose) · Socket.IO

## Setup

```bash
cp .env.example .env     # set MONGODB_URI and JWT_SECRET
npm install
npm run seed             # admin, doctors, patients, sample appointments
npm run dev              # API on :4000, client on :5173
```

MongoDB Atlas is the only service you must configure. Payments, image hosting and
the AI provider all have keyless local fallbacks, so the full demo runs without any
other accounts.

Demo credentials are printed by the seed script.
