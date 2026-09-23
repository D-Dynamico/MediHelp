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
| [`docs/UI_INVENTORY.md`](docs/UI_INVENTORY.md) | Every screen and shared component as they stand, and the gaps — the brief for the design pass |
| [`docs/sessions/`](docs/sessions/) | Running log of what changed and why |

## Stack

React + TypeScript + Tailwind (Vite) · Node + Express 5 + TypeScript ·
MongoDB Atlas (Mongoose) · Socket.IO

## Setup

You need **Node 20 or later** and a **MongoDB Atlas** cluster (the free tier is
fine). Nothing else: payments, image hosting and the AI provider all have keyless
local fallbacks, so the full demo runs without any other accounts.

```bash
npm install
cp .env.example .env     # then set the two required keys below
npm run seed             # fill the empty database with demo data
npm run dev              # API on :4000, client on :5173
```

In `.env`, set:

- `MONGODB_URI`: your Atlas connection string, **including the database name**
  (`…mongodb.net/medihelp`). In Atlas, allow your IP under *Network Access*.
- `JWT_SECRET`: any random string of at least 32 characters. Generate one with
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Every other key in `.env.example` is optional and explained there. Settings are
read once at startup, so restart `npm run dev` after changing `.env`.

Then open http://localhost:5173.

`npm run seed` refuses a database that already has accounts, so it can never
overwrite real data. `--force` overrides that; use it only on a database you mean
to wipe.

### Trying it without Atlas

The sandbox runs the same app against a throwaway in-memory database. It seeds it
on start and prints the demo logins. It needs no `.env` at all, and everything
disappears when you stop it:

```bash
npm run dev:sandbox
```

## Demo accounts

After seeding, in development:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@medihelp.test` | `Password123!` |
| Doctor | `rao@medihelp.test` (Dr. Anita Rao, general physician) | `Password123!` |
| Patient | `rahul@medihelp.test` (Rahul Verma) | `Password123!` |

There are eight doctors in all, each signing in as `{surname}@medihelp.test`
(`nair@`, `menon@`, `iyer@`, `desai@`, `reddy@`, `sheikh@`, `sharma@`), and five
patients (`rahul@`, `sneha@`, `tarun@`, `fatima@`, `joseph@`). Every demo doctor
and patient shares the one password. The seed prints the logins it used when it
finishes.

The well-known password exists only for development. With `NODE_ENV=production`
the seed refuses to run until `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` are
set to strong values of your own (see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)).

## A tour

Use two browser windows side by side, for example a normal one and a private one,
so a doctor and a patient can be signed in at once. The live parts are best seen
that way.

**As a patient** (`rahul@medihelp.test`)

1. **Triage** (`/triage`): describe how you feel, for example "chest pain and short
   of breath since this morning". You get an urgency level, a suggested
   specialty and a short note. Without an AI key this runs on the built-in rules
   engine, which gives the same kind of answer offline.
2. **Book**: from the triage result, go to the matching doctors (or browse them
   all at `/`), pick a slot and pay. With no Razorpay keys, the payment is a mock
   that settles at once. If you came from triage, the note goes with the booking
   and the doctor sees it.
3. **Waitlist**: on a day with no free slots, join the waitlist. When someone
   cancels, the slot is offered to the first person waiting, with ten minutes to
   claim it. Your offers and waitlist entries are under **My appointments**
   (`/my/appointments`).
4. **Live position**: on the day of the appointment, **My appointments** shows
   your token, your place in the queue and an estimated wait. It updates by
   itself as the doctor works through the queue.

**As a doctor** (`rao@medihelp.test`)

1. **Queue** (`/doctor/queue`): today's patients. Check them in, call the next
   one, and finish or mark a no-show. Every change reaches the patient's screen
   and the board straight away.
2. **Waiting-room board**: the queue page makes a signed link to a full-screen
   board of token numbers, with no names, for a screen in the waiting room. It
   needs no sign-in, and the link works for thirty days.
3. **Appointments and profile** (`/doctor/appointments`, `/doctor/profile`):
   read the triage note before a consult, and set fees, working hours and
   availability.

**As the admin** (`admin@medihelp.test`)

- **Dashboard** (`/admin`): counts and revenue at a glance.
- **Doctors** (`/admin/doctors`): add a doctor with a photo, edit one, remove or
  reinstate one.
- **Appointments** (`/admin/appointments`): filter every booking, then cancel or
  complete one.

To see the waitlist work end to end, fill one day of a doctor's slots, join that
day's waitlist as a second patient, and then cancel one of the bookings, either
as the patient who made it or as the admin. The offer appears on the waiting
patient's screen without a reload.

## Commands

```bash
npm run dev              # API on :4000 and client on :5173, both reloading on change
npm run dev:sandbox      # the same, against a throwaway in-memory database
npm run seed             # demo data into an empty database
npm run typecheck        # tsc --noEmit on both packages
npm run lint
npm run build            # production build of both
```

## Checks

These run against a MongoDB started on the fly, never your Atlas database, so
they need no setup:

```bash
npm run check --workspace server   # 18 scripts, around 700 assertions:
                                   # auth, admin, booking, payments, triage,
                                   # the live queue, the waitlist, security
                                   # headers, the audit trail, and more
npm run check --workspace client   # the browser side of signing in
```

Each server script can also run on its own, for example
`npm run check:queue --workspace server`. The full list is in
`server/package.json`.

Once you have an Atlas cluster in `.env`, `npm run check:atlas --workspace server`
checks the things only a hosted cluster can show. It only reads, unless you pass
`--seed`.
