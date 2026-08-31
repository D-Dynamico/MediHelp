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
│  └─ types.ts          Roles, statuses, DTOs — imported by client and server
├─ server/
│  ├─ src/
│  │  ├─ config/        env.ts (zod-validated settings), db.ts, logger.ts
│  │  ├─ models/        Mongoose schemas (see SYSTEM_DESIGN.md)
│  │  ├─ modules/       One folder per domain; each has
│  │  │                 *.routes.ts / *.controller.ts / *.service.ts / *.schema.ts
│  │  │                 auth, admin, doctor, patient, appointment,
│  │  │                 payment, triage, queue, waitlist
│  │  ├─ middleware/    auth (requireAuth, requireRole, requireOwnership),
│  │  │                 validate, error, rateLimit, upload
│  │  ├─ realtime/      io.ts (server + handshake auth), queue.gateway.ts
│  │  ├─ jobs/          waitlistSweeper.ts (node-cron)
│  │  ├─ providers/     payment/, storage/, ai/ — swappable integrations
│  │  ├─ utils/         tokens, apiError, eta, slots
│  │  └─ seed.ts
│  └─ uploads/          Local image store (default storage provider)
└─ client/
   └─ src/
      ├─ api/           axios instance with refresh interceptor, typed endpoints
      ├─ context/       AuthContext, SocketContext
      ├─ routes/        router.tsx, ProtectedRoute, RoleRoute
      ├─ pages/         public/ patient/ doctor/ admin/ board/
      ├─ components/    ui/ primitives, domain/ composites
      └─ hooks/         useAuth, useSocket, useQueue
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
| `doctor` | Own profile, own appointments, earnings, availability |
| `patient` | Own profile, browse doctors, own appointments |
| `appointment` | Slot generation, booking, cancellation, completion — the shared core |
| `payment` | Order creation, verification, cash settlement |
| `triage` | Symptom assessment and specialty routing |
| `queue` | Token allocation, call-next, live ETA |
| `waitlist` | Waiting entries, cancellation offers, claims |

Cross-module work goes through the owning module's **service**, never by reaching
into another module's models directly.

## Swappable providers

Only MongoDB Atlas is a hard external dependency. Everything else sits behind a
small interface chosen at startup from env, each with a keyless local default so
the project boots and demos with just `MONGODB_URI`:

| Provider | Default (no keys) | Real option |
|---|---|---|
| `providers/payment` | `mock` — fake order id, marks paid | Razorpay orders + HMAC signature verification |
| `providers/storage` | `local` — writes to `server/uploads/` | Cloud object storage |
| `providers/ai` | `rules` — deterministic offline triage engine | Claude API when `ANTHROPIC_API_KEY` is set |

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
fight locally. In production the API sets an explicit CORS allowlist from env.
