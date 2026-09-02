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

## Documentation

| Doc | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Session protocol and ground rules |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Folder layout, stack, module boundaries |
| [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | Data models, auth and security, the three features, API surface |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | Commit style, session notes, definition of done |
| [`docs/PHASES.md`](docs/PHASES.md) | Build plan, phase by phase |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | How it goes live: one service on Render, with Atlas and Cloudinary |
| [`docs/sessions/`](docs/sessions/) | Running log of what changed and why |

## Stack

React + TypeScript + Tailwind (Vite) · Node + Express 5 + TypeScript ·
MongoDB Atlas (Mongoose) · Socket.IO

## Setup

```bash
cp .env.example .env     # set MONGODB_URI and JWT_SECRET
npm install
npm run dev              # API on :4000, client on :5173
```

Then open http://localhost:5173 — the page shows the live API status, so you can
see both halves are talking.

To click around without touching your real database, use the sandbox instead. It
runs the same server against a throwaway in-memory one, seeds it, and prints the
demo logins:

```bash
npm run dev:sandbox
```

MongoDB Atlas is the only service you must configure. Payments, image hosting and
the AI provider all have keyless local fallbacks, so the full demo runs without any
other accounts.

`npm run seed` fills an empty database with an admin, doctors, patients and
sample appointments, and prints the demo credentials at the end. It refuses a
database that already has accounts unless you pass `--force`.

Other commands:

```bash
npm run typecheck        # tsc --noEmit on both packages
npm run lint
npm run build            # production build of both
```

Checks — these run against a real MongoDB started on the fly, so they need no
setup:

```bash
npm run check --workspace server   # models, errors, auth, rate limiting, seed
npm run check --workspace client   # the browser side of signing in
```

Once you have an Atlas cluster in `.env`, `npm run check:atlas --workspace server`
verifies the things only a hosted cluster can show.
