# 2026-08-31 — Project docs and session protocol

## Scope

Set up the written memory for MediHelp before any code is written: `CLAUDE.md`,
the `docs/` reference set, the phase plan, and a Stop hook that reminds each
session to keep them current.

## Changes

- **`CLAUDE.md` (85 lines)** — session protocol first, then a documentation map,
  the stack, ground rules and commands. Deliberately short: it is loaded into
  every session's context, so detail belongs in `docs/`, not here.
- **`docs/ARCHITECTURE.md`** — folder layout, layering rules (routes →
  controllers → services → models), module ownership, and the swappable-provider
  pattern for payments, storage and AI. Written so a new session can place a file
  correctly without reading the code.
- **`docs/SYSTEM_DESIGN.md`** — data models with the indexes that matter, the auth
  and security design, the three flagship features in depth, and the API surface.
  This is the file to read before touching behavior.
- **`docs/WORKFLOW.md`** — commit style (plain language, no conventional-commit
  prefixes or jargon, with good/bad examples), the session-note template, a
  docs-upkeep table, and the definition of done.
- **`docs/PHASES.md`** — twelve phases, each broken into 5–6 numbered substeps
  (69 in total), with exit criteria. Ordered so the app is runnable early: phases
  1–7 are the complete hospital system, 8–10 are the three differentiators, 11–12
  are polish and hardening. Exit criteria are written as observable outcomes, not
  "implement X", so a phase cannot be ticked off on reading the code alone. The
  substeps are sized to be one sitting each and ordered so a phase stays runnable
  partway through — server before client in every phase, so the UI is always built
  against a working endpoint.
- **`.claude/settings.local.json`** — Stop hook printing the protocol reminder.
  Local, not project, settings so it is a personal reminder rather than something
  imposed on anyone who clones the repo; added to `.gitignore` for the same
  reason.
- **`README.md`** — rewritten from a one-line stub into a human-facing intro,
  doc index and setup steps.
- **`.gitignore`** — `.env`, `node_modules`, uploads, build output, local settings.

**Why the docs came first**: the session protocol only works if the docs it points
at exist. Writing them up front also forced the data model, auth design and phase
boundaries to be settled before any code locks them in.

## Verification

- `CLAUDE.md` is 85 lines, under the 100-line ceiling (`wc -l`).
- Hook JSON parses and the command resolves correctly
  (`node -e "require('./.claude/settings.local.json')"` prints the echo command).
- The hook itself has not been observed firing — a Stop hook fires outside the
  turn that writes it, and the settings watcher does not pick up a `.claude/`
  directory that did not exist when the session started. Open `/hooks` once or
  restart Claude Code to load it.

## Open items

- No code yet. Phase 1 (scaffold) is next.
- `MONGODB_URI` for an Atlas cluster is still needed before Phase 2 can be
  verified; there is no local `mongod` on this machine.
- `.env.example` will be created in Phase 1 — the README already references it.

---

# Phase 1 — Scaffold

Working on branch `phase-1-scaffold`. One commit per substep, this log updated
with each.

## 1.1 Root workspace

- Root `package.json` with npm workspaces (`server`, `client`) and `concurrently`
  driving `npm run dev`. Scripts fan out with `--workspaces --if-present` so
  `typecheck` and `lint` keep working before both packages define them.
- **Why workspaces**: one `npm install` and one `node_modules` for the whole repo,
  and the client can depend on shared types without a publish step.
- Files: `package.json`, `package-lock.json`.
- Verified: `npm install` clean (0 vulnerabilities), `npx concurrently --version`
  → 9.2.4.

## 1.2 Server package

- `server/` on Express 5 + TypeScript, run in development with `tsx watch`.
  `createApp()` lives in `app.ts` separately from the `index.ts` bootstrap so
  tests and the Socket.IO server in phase 9 can wrap the same app instead of
  starting a second one.
- `tsconfig.json` is strict, plus `noUncheckedIndexedAccess` and `noUnusedLocals`.
  `rootDir` is the repo root and `@shared/*` is mapped to `../shared/*`, so the
  server can import shared types in 1.4 — that is also why the built entry point
  is `dist/server/src/index.js`.
- ESLint 9 flat config with `consistent-type-imports`, since `type: "module"` plus
  NodeNext makes accidental value imports of type-only modules a runtime error.
- Files: `server/package.json`, `server/tsconfig.json`,
  `server/tsconfig.build.json`, `server/eslint.config.js`, `server/src/app.ts`,
  `server/src/index.ts`.
- Verified: `npm run typecheck` and `npm run lint` both clean;
  `curl localhost:4000/api/health` → `{"status":"ok","uptime":4.74}`.

## 1.3 Client package

- `client/` on Vite 6 + React 19 + TypeScript, Tailwind 3, React Router 7.
  A single app with role-guarded route groups, so `routes/router.tsx` is the one
  place route groups get added in later phases.
- Vite proxies `/api` and `/socket.io` (with `ws: true`) to `localhost:4000`, so
  there is no CORS setup in development and the websocket upgrade in phase 9 will
  already work.
- Tailwind carries the theme tokens (`brand`, `ink`, `surface`) and
  `darkMode: 'class'` from the start, so phase 11's polish is a matter of using
  the tokens rather than retrofitting them.
- Aliases `@/*` → `src` and `@shared/*` → `../shared` are set in both
  `vite.config.ts` and `tsconfig.json`; the editor and the bundler have to agree
  or one of them silently breaks.
- The home page fetches `/api/health` and shows the result — a live check that the
  proxy works, not just a static placeholder.
- Files: `client/package.json`, `vite.config.ts`, `tsconfig.json`,
  `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`, `index.html`,
  `src/main.tsx`, `src/index.css`, `src/routes/router.tsx`, `src/pages/Home.tsx`.
- Verified: `npm run dev` starts both; `curl localhost:5173/` serves the app shell
  and `curl localhost:5173/api/health` returns the API's response through the
  proxy. `npm run build --workspace client` succeeds (42 modules) and the built
  CSS carries the theme tokens (`body{background-color:rgb(246 248 251...)}`,
  `text-brand-700`).
- **Not verified**: no visual browser check — the Chrome extension is not
  connected in this environment. The production build plus the proxied fetch is
  the strongest check available here.

## 1.4 Shared types

- `shared/types.ts` holds the contract between client and server: roles,
  appointment statuses, payment modes and statuses, urgencies, specialities,
  waitlist states, the uniform `ApiErrorBody`, and the DTOs for user, doctor,
  appointment and slot.
- Written as `as const` arrays with types derived from them
  (`type Role = (typeof ROLES)[number]`), so each list is one declaration that
  serves both runtime validation and the type system. `zod` enums in phase 2/3
  will be built from these arrays rather than repeating the strings.
- `ACTIVE_APPOINTMENT_STATUSES` is separated out with a `satisfies` check: it is
  the set that still occupies a slot, and it drives both the unique-index filter
  and slot generation. Getting that list wrong in two places is how double
  bookings appear, so it is declared once.
- The file has no imports, so it stays usable from either runtime.
- Wired in on both sides: the server's `/api/health` is typed with
  `HealthResponse` and a new `/api/specialities` returns the shared list; the home
  page renders the specialities and types the health response.
- **Snag**: after installing the client dependencies, `tsx` died with
  `The package "@esbuild/win32-x64" could not be found`. npm had hoisted a shared
  esbuild without its platform binary — the known npm optional-dependency bug.
  Fixed by deleting `node_modules` and `package-lock.json` and reinstalling; the
  committed lockfile is from that clean install.
- Verified: both alias directions resolve at runtime, not just in the type
  checker. `curl localhost:4000/api/specialities` returns all eight from the
  shared value import through `tsx`, and `Gastroenterologist` appears in the
  client's production bundle, proving the Vite alias resolves too. Typecheck and
  lint clean on both workspaces.

## 1.5 Env and docs

- `.env.example` documents every key with a comment, grouped by concern, and says
  up front that only `MONGODB_URI` and `JWT_SECRET` are required — the rest have
  working local defaults (`PAYMENT_PROVIDER=mock`, `STORAGE_PROVIDER=local`, empty
  `ANTHROPIC_API_KEY` meaning the rules engine). It also carries the
  restart-after-change warning, since `getSettings()` caches.
- `server/uploads/.gitkeep` so the folder the local storage provider writes to
  exists in a fresh clone; `.gitignore` already keeps its contents out.
- README updated to say phase 1 of 12 is done, with accurate commands — and an
  explicit note that `npm run seed` arrives in phase 2, rather than leaving a
  command in the setup block that would fail today.

## Phase 1 exit check

Ran from a clean start, after killing the stray dev servers holding ports 4000
and 5173:

| Check | Result |
|---|---|
| `npm run dev` starts both | server on :4000, client on :5173 |
| `curl :4000/api/health` | `{"status":"ok","uptime":3.53}` |
| `curl :5173/api/health` (proxied) | `{"status":"ok","uptime":3.61}` |
| Client serves the app shell | `#root` present |
| `npm run typecheck` | clean on both workspaces |
| `npm run lint` | clean on both workspaces |
| `npm run build` | both build; shared value present in the client bundle |

Phase 1 complete; boxes ticked in `docs/PHASES.md`.

## Open items after phase 1

- No visual browser check has been possible this session — the Chrome extension
  is not connected. Worth a manual look at http://localhost:5173 before phase 11.
- `MONGODB_URI` for an Atlas cluster is needed before phase 2 can be verified end
  to end; there is no local `mongod` on this machine.
- Work is on branch `phase-1-scaffold`, not merged to `main`.

---

# Deployment decisions

The project is going to be deployed, which forced three choices before phases
3, 4 and 7 bake in assumptions that only break in production.

- **One service, one origin** — Express serves `/api`, `/socket.io` and the built
  client. **Why**: it keeps the refresh cookie at `sameSite=strict`. A split
  deployment (frontend on Vercel, API elsewhere) would force `sameSite=none`,
  which sends the cookie cross-site and reopens the CSRF hole `strict` closes for
  free — meaning a CSRF token layer we otherwise never need. It also removes CORS
  from both environments and keeps the client free of any API base URL, so there
  is no environment-specific client build.
- **Render free tier** — supports websockets and a long-lived process, which
  Socket.IO and the `node-cron` sweeper both require (Vercel serverless could not
  host either). It sleeps after 15 minutes: first request takes ~50s, and the
  sweeper does not run while asleep. Accepted, because the claim window is checked
  against the clock at claim time rather than trusted to have been swept, so
  waitlist offers expire *late*, never *wrongly*. Documented rather than papered
  over with an external pinger.
- **Cloudinary for images** — Render's disk is ephemeral, so `server/uploads/`
  would be wiped on every redeploy and doctor photos would vanish. The storage
  provider interface was already planned, so this is one implementation file plus
  keys; local disk stays the development default when no keys are set.

Docs changed: new `docs/DEPLOYMENT.md` (topology, Render settings, Atlas and
Cloudinary setup, pre-deploy checklist, five post-deploy checks);
`docs/ARCHITECTURE.md` gained a production-topology section; `docs/SYSTEM_DESIGN.md`
records why `sameSite=strict` is affordable and drops the CORS allowlist that the
same-origin decision makes unnecessary; `docs/PHASES.md` gained **phase 13**
(7 substeps) and 4.2 now includes the Cloudinary implementation; `.env.example`
gained the Cloudinary keys and an honest `CORS_ORIGINS` note; README links the new
doc and says 13 phases.

No application code changed — the static-serving branch, `trust proxy` and the
Cloudinary provider are phase 13 and 4.2 work.
