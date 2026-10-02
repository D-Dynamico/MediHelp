# 2026-10-02 — Phase 13: production build and serving the client

**Scope**: get the project deployable. The user asked to deploy; 13.1 and 13.2
had to land first, because without them the Render service would serve an API
with no pages, and (as it turned out) the compiled server could not start at
all. 13.6 and 13.7 need the user's Render and Atlas accounts and are handed over
at the end.

Started from `0f6f8f7`, tree clean.

---

## 13.1 Production build

**The built server crashed on its first import.** `npm run build` had always
succeeded, but nobody had run its output: `node dist/server/src/index.js` died
with `Cannot find package '@shared/types.js'`. Three separate faults, all
invisible under `tsx`, which is all development ever used:

1. **`@shared/*` is a TypeScript path alias.** `tsc` uses it to type-check and
   copies it into the output unchanged; Node has no idea what it means.
   *Fix*: `server/scripts/rewrite-shared-imports.ts` runs after `tsc` in the
   server's `build` and rewrites each `'@shared/x.js'` into the right relative
   path. It fails the build if any `@shared/` import survives, so a form it
   misses cannot ship. Considered instead: Node subpath imports (`#shared/*`)
   — their targets may not leave the package folder, and `shared/` is a
   sibling; `tsc-alias` — a dependency for twenty lines of script.
2. **`shared/` compiled to CommonJS.** `tsc` with `NodeNext` picks the format
   from the nearest `package.json`; for `shared/` that was the root one, which
   has no `"type"`. The output then landed under `server/`, whose
   `package.json` says `"type": "module"`, so Node loaded CommonJS as ESM and
   found no exports. *Fix*: `shared/package.json` with `"type": "module"`. The
   client (Vite) does not care either way.
3. **Two files counted `../../..` from themselves** to find the repo
   (`config/env.ts` for `.env`, `providers/storage/local.ts` for `uploads/`).
   The build puts them two folders deeper, so a built server would have read
   no `.env` and written uploads into `server/dist/server/uploads`. *Fix*:
   `config/paths.ts` walks up to the `package.json` that declares workspaces
   and exports `REPO_ROOT`, `SERVER_ROOT` and `CLIENT_DIST`; both files use it.
   (`PORT` from env and binding `0.0.0.0` were already in `index.ts`.)

Plus a root `start` script (`npm start --workspace server`), which is what
Render's start command runs.

**Verified**: the built server now starts with `NODE_ENV=production` through the
root `npm start` against an in-memory database. The full checks are in the 13.2
entry, which tested both steps together.
