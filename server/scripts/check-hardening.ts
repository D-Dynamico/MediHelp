/**
 * Checks the request hardening that sits in front of every route: security
 * headers, the CORS allowlist, and the sanitizer under zod.
 * Run with: npm run check:hardening --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'h'.repeat(48);
process.env.LOG_LEVEL = 'error';
// Whatever .env says, start from the normal same-origin setup.
process.env.CORS_ORIGINS = '';

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();
const { createApp } = await import('../src/app.js');
const { reloadSettings } = await import('../src/config/env.js');
const { sanitizeRequest } = await import('../src/middleware/sanitize.js');
const { uploadImage } = await import('../src/middleware/upload.js');
const { errorHandler } = await import('../src/middleware/error.js');

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
};

/** Starts an app on a free port, runs `body` against it, and closes it. */
async function withServer(app: Express, body: (base: string) => Promise<void>) {
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

// --- security headers ---
await withServer(createApp(), async (base) => {
  const res = await fetch(`${base}/api/health`);
  const csp = res.headers.get('content-security-policy') ?? '';

  check('responses carry a content security policy', csp.includes("default-src 'self'"), csp);
  check(
    'the policy lets the Razorpay checkout script load',
    /script-src [^;]*https:\/\/checkout\.razorpay\.com/.test(csp),
    csp,
  );
  check('the policy gives scripts no inline allowance', !/script-src [^;]*unsafe-inline/.test(csp), csp);
  check('the policy does not upgrade local http requests', !csp.includes('upgrade-insecure-requests'), csp);
  check('nosniff is set on every response', res.headers.get('x-content-type-options') === 'nosniff');
  check('framing is refused', res.headers.get('x-frame-options') === 'SAMEORIGIN');
  check('Express no longer announces itself', res.headers.get('x-powered-by') === null);
  check(
    "popups keep their link to the page (Razorpay's checkout needs it)",
    res.headers.get('cross-origin-opener-policy') === 'same-origin-allow-popups',
    res.headers.get('cross-origin-opener-policy'),
  );

  // Parses fine and fits under the size cap, but used to overflow the stack in
  // the sanitizer and come back as a 500, on a route that needs no login.
  const deep = '['.repeat(45_000) + ']'.repeat(45_000);
  const nested = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: deep,
  });
  check('a deeply nested body is a 400, not a crash', nested.status === 400, nested.status);

  // --- CORS, off by default ---
  const preflight = await fetch(`${base}/api/health`, {
    method: 'OPTIONS',
    headers: { origin: 'https://elsewhere.example', 'access-control-request-method': 'GET' },
  });
  check(
    'with CORS_ORIGINS empty, no other origin is allowed',
    preflight.headers.get('access-control-allow-origin') === null,
    preflight.headers.get('access-control-allow-origin'),
  );

  // --- the sanitizer is mounted on the real app ---
  // A repeated key used to reach zod as an array and be turned away. Now the
  // last value wins, as it does with `hpp`.
  const repeated = await fetch(`${base}/api/doctors?speciality=Pediatrician&speciality=Dermatologist`);
  check('a repeated query key is collapsed rather than refused', repeated.status === 200, repeated.status);
});

// --- CORS, with an allowlist ---
process.env.CORS_ORIGINS = 'https://app.medihelp.example, https://admin.medihelp.example';
reloadSettings();
await withServer(createApp(), async (base) => {
  const allowed = await fetch(`${base}/api/health`, {
    method: 'OPTIONS',
    headers: { origin: 'https://admin.medihelp.example', 'access-control-request-method': 'POST' },
  });
  check(
    'a listed origin is allowed, with credentials',
    allowed.headers.get('access-control-allow-origin') === 'https://admin.medihelp.example' &&
      allowed.headers.get('access-control-allow-credentials') === 'true',
    Object.fromEntries(allowed.headers),
  );

  const refused = await fetch(`${base}/api/health`, {
    headers: { origin: 'https://evil.example' },
  });
  check(
    'an unlisted origin is not allowed',
    refused.headers.get('access-control-allow-origin') === null,
    refused.headers.get('access-control-allow-origin'),
  );
});
process.env.CORS_ORIGINS = '';
reloadSettings();

// --- the sanitizer itself, on an app that echoes what a handler would see ---
const echo = express();
echo.use(express.json());
echo.use(sanitizeRequest);
echo.all('/echo', (req, res) => {
  res.json({ body: req.body as unknown, query: req.query });
});
// A multipart form, as the profile and add-doctor routes take them. Its fields
// only exist once multer has run, after the app-wide sanitizer.
echo.post('/form', ...uploadImage('image'), (req, res) => {
  res.json({ body: req.body as unknown });
});
echo.use(errorHandler);

await withServer(echo, async (base) => {
  const res = await fetch(`${base}/echo?sort=name&sort=date&%24where=1&plain=ok`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: { $ne: null },
      password: 'secret',
      'profile.role': 'admin',
      nested: { list: [{ $gt: '', keep: 1 }], fine: true },
    }),
  });
  const seen = (await res.json()) as { body: Record<string, unknown>; query: Record<string, unknown> };

  check(
    'operator keys are removed from the body at any depth',
    JSON.stringify(seen.body) ===
      JSON.stringify({ email: {}, password: 'secret', nested: { list: [{ keep: 1 }], fine: true } }),
    seen.body,
  );
  check('dotted paths are removed from the body', !('profile.role' in seen.body), seen.body);
  check('the last value of a repeated query key wins', seen.query.sort === 'date', seen.query);
  check('operator keys are removed from the query', !('$where' in seen.query), seen.query);
  check('ordinary query values pass through untouched', seen.query.plain === 'ok', seen.query);

  const form = new FormData();
  form.append('name', 'Dr. Form');
  form.append('$where', 'sleep(1000)');
  form.append('profile.role', 'admin');
  const multipart = await fetch(`${base}/form`, { method: 'POST', body: form });
  const fields = ((await multipart.json()) as { body: Record<string, unknown> }).body;
  check(
    'a multipart form is cleaned too, once its fields exist',
    JSON.stringify(fields) === JSON.stringify({ name: 'Dr. Form' }),
    fields,
  );
});

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
