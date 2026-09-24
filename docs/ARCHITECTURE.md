# Architecture

## Shape of the system

One Express API server, one React single-page app, one MongoDB Atlas database, and
a Socket.IO channel riding on the same HTTP server as the API.

```
Browser (React SPA)
   │  REST over /api          │  websocket /socket.io
   ▼                          ▼
Express 5 (TypeScript) ── Socket.IO server
   │
   ▼
MongoDB Atlas (Mongoose)
```

The client is a **single Vite app** with role-guarded route groups rather than
separate patient and admin builds — one codebase, one auth context, one deploy.

## Folder layout

```
MediHelp/
├─ CLAUDE.md            Session protocol + ground rules (start here)
├─ README.md            Human setup and run instructions
├─ docs/                Architecture, system design, workflow, phases, sessions
├─ shared/
│  ├─ types.ts          Roles, statuses, DTOs — imported by client and server
│  └─ queue.ts          Wait-estimate maths, so both sides show the same number
├─ server/
│  ├─ src/
│  │  ├─ config/        env.ts (zod-validated settings), db.ts, logger.ts
│  │  ├─ models/        Mongoose schemas (see SYSTEM_DESIGN.md)
│  │  ├─ modules/       One folder per domain; each has
│  │  │                 *.routes.ts / *.controller.ts / *.service.ts / *.schema.ts,
│  │  │                 plus *.mapper.ts where a DTO is shared
│  │  │                 auth, admin, doctors, patients, appointments,
│  │  │                 payments, triage, queue, waitlist
│  │  ├─ middleware/    auth (requireAuth, requireRole, requireOwnership, audit),
│  │  │                 validate, sanitize, error, rateLimit, upload
│  │  ├─ realtime/      io.ts (socket server, handshake auth, room names)
│  │  ├─ jobs/          waitlistSweeper.ts (node-cron)
│  │  ├─ providers/     payment/, storage/, ai/ — swappable integrations
│  │  ├─ utils/         tokens, password, apiError, dates, slots, availability,
│  │  │                 eta, changes (what an edit changed, for the audit trail)
│  │  ├─ types/         express.d.ts (req.auth, req.rawBody, req.uploadedImage)
│  │  └─ seed.ts
│  ├─ scripts/          check-*.ts (one per area, run by `npm run check`),
│  │                    dev-sandbox.ts, refresh-demo-photos.ts
│  └─ uploads/          Local image store (default storage provider)
└─ client/
   └─ src/
      ├─ api/           axios instance with refresh interceptor, typed endpoints,
      │                 socket.ts (the one live connection, with session renewal)
      ├─ context/       AuthContext
      ├─ routes/        router.tsx, guards.tsx (signed-in and role guards)
      ├─ pages/         public/ (catalogue and the board), patient/, doctor/, admin/
      ├─ components/    ui/ primitives, plus composites (WorkShell, QueueCard,
      │                 WaitlistPanel)
      └─ hooks/         useAuth, useQueue, useWaitlist
```

## Layering rules

- **routes** declare paths, attach middleware, and nothing else.
- **controllers** parse the validated request, call one service, shape the response.
  No database calls, no business rules.
- **services** own the business rules and are the only layer that touches models.
  Services may call other services.
- **models** are schemas plus small instance helpers — no cross-domain logic.

A request that skips a layer is a bug waiting to happen. Keep the chain intact.

## Module boundaries

| Module | Owns |
|---|---|
| `auth` | Register, login, refresh rotation, logout, current user |
| `admin` | Dashboard stats, doctor CRUD, all-appointments view and actions |
| `doctors` | The doctor's own profile, appointments, earnings and availability, plus the public catalogue and free slots (`public.routes.ts`) |
| `patients` | The patient's own profile |
| `appointments` | Booking (with its token number), the patient's own list, and cancel, start, complete and no-show, shared by every role |
| `payments` | Order creation, signature verification, the signed webhook, the demo's mock confirmation |
| `triage` | Symptom assessment and specialty routing |
| `queue` | Check-in, call-next, the live snapshot and wait estimate, the waiting-room board |
| `waitlist` | Waiting entries, cancellation offers (and the hold on the offered slot), claims |

Cross-module work goes through the owning module's **service**, never by reaching
into another module's models directly.

## Swappable providers

Only MongoDB Atlas is a hard external dependency. Everything else sits behind a
small interface chosen at startup from env, each with a keyless local default so
the project boots and demos with just `MONGODB_URI`:

| Provider | Default (no keys) | Real option |
|---|---|---|
| `providers/payment` | `mock` — fake order id, marks paid | Razorpay orders + HMAC signature verification |
| `providers/storage` | `local` — writes to `server/uploads/` | Cloudinary (used in production) |
| `providers/ai` | `rules` — deterministic offline triage engine | `openai/gpt-oss-120b` on Groq (free tier) when `GROQ_API_KEY` is set |

Adding a real provider must never change a caller. If it does, the interface is
wrong.

## Configuration

`server/src/config/env.ts` parses `process.env` through a zod schema once and
exports `getSettings()`. The parsed object is **cached** — config changes need a
server restart. `reloadSettings()` exists for scripts and tests only. Every key
lives in `.env.example` with a comment.

## Dev setup

Root `package.json` runs both packages with `concurrently`. Vite proxies `/api`
and `/socket.io` to `localhost:4000` in dev, so there is no CORS configuration to
fight locally.

## Production topology

The same two packages ship as **one service**: Express serves `/api`,
`/socket.io` and — in production only — the built client from `client/dist`, all
on one origin. CORS stays off in production too, because `CORS_ORIGINS` is
empty. The refresh cookie keeps `sameSite=strict` because nothing is cross-site.

The development proxy exists precisely so the client makes the same same-origin
relative requests (`/api/...`) in both environments. Nothing in the client knows
an API base URL, so there is no environment-specific client build.

Deployment target, host settings and caveats: `docs/DEPLOYMENT.md`.
