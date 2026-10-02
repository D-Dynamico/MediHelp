/**
 * Turns `@shared/...` imports in the compiled server into relative paths.
 *
 * Run by `npm run build`, straight after `tsc`.
 *
 * `@shared/*` is a TypeScript path alias. `tsc` uses it to find the types but
 * copies the import into the output unchanged, and Node has never heard of it:
 * the built server would crash on its first import. `tsx` resolves the alias
 * itself, which is why development never showed this.
 *
 * Fails the build if any `@shared/` import is left behind, so a new import form
 * this misses cannot ship quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const sharedOut = path.join(dist, 'shared');
const serverOut = path.join(dist, 'server');

// `from '@shared/x.js'`, `import '@shared/x.js'` and `import('@shared/x.js')`.
const specifier = /(['"])@shared\/([^'"]+)\1/g;

function* jsFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

if (!fs.existsSync(sharedOut)) {
  console.error(`\n  No compiled shared types at ${sharedOut}. Run tsc first.\n`);
  process.exit(1);
}

let rewritten = 0;
const leftovers: string[] = [];

for (const file of jsFiles(serverOut)) {
  const before = fs.readFileSync(file, 'utf8');
  let relative = path.relative(path.dirname(file), sharedOut).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = `./${relative}`;

  const after = before.replace(specifier, (_match, quote: string, rest: string) => `${quote}${relative}/${rest}${quote}`);
  if (after !== before) {
    fs.writeFileSync(file, after);
    rewritten += 1;
  }
  if (/['"]@shared\//.test(after)) leftovers.push(path.relative(dist, file));
}

if (leftovers.length > 0) {
  console.error(`\n  @shared imports survived in:\n${leftovers.map((f) => `    ${f}`).join('\n')}\n`);
  process.exit(1);
}

console.log(`Rewrote @shared imports in ${rewritten} compiled files.`);
