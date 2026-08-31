# Deployment

MediHelp deploys as **one service**: the Express server serves the API, the
websocket, and the built React client from the same origin. Target host is
**Render** (free tier to start), with **MongoDB Atlas** and **Cloudinary**.

Built in phase 13 — see `docs/PHASES.md`. This file is the reference for how it
is meant to work and why.

---

## Why one service

The client and API share an origin, which buys three things:

- **The refresh cookie keeps `sameSite=strict`.** A split deployment would force
  `sameSite=none`, which sends the cookie on cross-site requests and reopens the
  CSRF hole that `strict` closes for free. Same origin means no CSRF token layer.
- **No CORS.** Nothing to allowlist, nothing to get wrong between environments.
- **One URL, one deploy, one log stream.** Easier to debug, and a portfolio
  reviewer follows one link.

The cost is no CDN in front of the frontend assets. At this scale that is a
non-issue — Express serves them gzipped with long cache headers.

```
                    Render web service
                 ┌───────────────────────┐
 browser ────────┤ Express               │
                 │  /api/*   → API       │
                 │  /socket.io → queue   │──── MongoDB Atlas
                 │  /*       → client    │──── Cloudinary
                 └───────────────────────┘
```

---

## What runs where

| Piece | Where | Notes |
|---|---|---|
| API + websocket + client | Render web service | Single Node process |
| Database | MongoDB Atlas free tier | 512 MB, shared cluster |
| Images | Cloudinary free tier | Survives redeploys; Render's disk does not |
| Waitlist sweeper | In-process `node-cron` | Runs inside the same process; see the sleeping caveat |

---

## Render setup

**Service type**: Web Service (not Static Site — the app needs a live process for
Socket.IO and the cron sweeper).

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Node version | 20 or later (set `NODE_VERSION` if needed) |

`npm run build` builds both workspaces: `tsc` for the server into `server/dist`,
Vite for the client into `client/dist`. In production the server resolves
`client/dist` and serves it with an SPA fallback, so a hard refresh on
`/doctor/appointments` returns `index.html` rather than a 404 — with `/api` and
`/socket.io` matched first so they never fall through to the client.

### Environment variables

Set these in the Render dashboard, not in a committed file. Every key is
documented in `.env.example`.

```
NODE_ENV=production
MONGODB_URI=<Atlas connection string>
JWT_SECRET=<48 random bytes, hex>
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Leave `PAYMENT_PROVIDER=mock` unless you have Razorpay keys, and leave
`ANTHROPIC_API_KEY` empty to run triage on the offline rules engine. Both degrade
deliberately, so the deployed demo is complete either way.

`PORT` is injected by Render — the server must read it and must bind `0.0.0.0`,
not `localhost`, or the health check never passes.

### The free tier sleeps

Render's free tier suspends the service after 15 minutes of inactivity. Two
consequences, both worth knowing before a demo:

- **First request after idle takes ~50 seconds** while the container wakes.
- **The cron sweeper does not run while asleep.** Waitlist offers expire late —
  they are swept on the next wake, not on the minute. The claim window is still
  enforced correctly at claim time, because `offerExpiresAt` is checked against
  the clock rather than trusted to have been swept; the sweeper only cascades the
  offer onward. So the behaviour degrades to "late", never to "wrong".

Upgrading to a paid instance removes both. Do not paper over it with an external
pinger — that burns the free tier's monthly hours for no real benefit.

---

## MongoDB Atlas

1. Create a free M0 cluster and a database user with read/write on `medihelp`.
2. **Network Access** → allow `0.0.0.0/0`. Render's free tier has no static
   outbound IP, so an IP allowlist cannot be narrowed. The database user's
   password is the real access control; make it long and random.
3. Put the connection string in `MONGODB_URI`, including the database name.

Seeding production is a deliberate act, not part of the deploy: run
`npm run seed` against the production `MONGODB_URI` from your machine, once. The
seed script must refuse to run against a database that already has users unless
`--force` is passed, so a redeploy can never wipe real data.

---

## Cloudinary

Local development writes to `server/uploads/` and needs no account — the storage
provider only switches to Cloudinary when `STORAGE_PROVIDER=cloudinary` and the
keys are present. Production sets both.

Render's filesystem is ephemeral: anything written to disk is gone on the next
deploy or restart. That is why uploads cannot stay local in production, and why
`server/uploads/` is gitignored rather than committed.

---

## Pre-deploy checklist

- [ ] `npm run build` succeeds from a clean clone
- [ ] `NODE_ENV=production npm start` serves the client and the API on one port
- [ ] Cookies are `secure` and `sameSite=strict` in production (`secure` off in
      development, or nothing works over plain http on localhost)
- [ ] `app.set('trust proxy', 1)` so `secure` cookies and rate-limit IPs work
      behind Render's proxy
- [ ] No secret is in the repo; `.env` is gitignored and `.env.example` has no
      real values
- [ ] Atlas network access and database user configured
- [ ] Health check returns 200 at `/api/health`
- [ ] Seed run once against production, then demo credentials noted

---

## After deploying

Check these in the deployed app, not just locally:

1. Log in as all three seeded roles — proves cookies survive the proxy and TLS.
2. Book an appointment — proves Atlas writes and the unique slot index work.
3. Open the queue board in a second browser and click "next patient" — proves
   Render's proxy passes the websocket upgrade rather than falling back to
   long-polling failures.
4. Add a doctor with a photo — proves Cloudinary is wired, and the photo should
   still be there after a redeploy.
5. Hard-refresh a deep link like `/admin/appointments` — proves the SPA fallback.
