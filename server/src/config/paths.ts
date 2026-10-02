import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The folder holding the whole repo, found by walking up to the `package.json`
 * that declares the workspaces.
 *
 * Counting `../` from this file does not work: under `tsx` it runs from
 * `server/src/config/`, but the build compiles it to
 * `server/dist/server/src/config/`, two folders deeper. A fixed count would find
 * `.env`, the uploads and the built client in development and miss all three in
 * production.
 */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      const { workspaces } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (workspaces) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not find the MediHelp repo root above ' + fileURLToPath(import.meta.url));
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

/** `server/`, where local uploads live. */
export const SERVER_ROOT = path.join(REPO_ROOT, 'server');

/** The Vite build of the client, served by Express in production. */
export const CLIENT_DIST = path.join(REPO_ROOT, 'client', 'dist');
