/**
 * Checks the rate limiter refuses a flood, and that it refuses it in the same
 * shape as every other error. Run with: npm run check:ratelimit --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'd'.repeat(48);
process.env.LOG_LEVEL = 'error';
// Not 'test': the limiter deliberately steps aside there, and here it is the
// thing being tested.
process.env.NODE_ENV = 'development';

const { createApp } = await import('../src/app.js');
const { UserModel } = await import('../src/models/index.js');

// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();
await UserModel.syncIndexes();

const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function login(email = 'nobody@example.com') {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'whatever' }),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as { error?: { code?: string } } };
}

// The limit is 20 sign-in attempts per window.
const statuses: number[] = [];
for (let attempt = 0; attempt < 22; attempt += 1) {
  // A different email each time: this is credential stuffing, which a
  // per-account lockout would never notice.
  statuses.push((await login(`victim${attempt}@example.com`)).status);
}

check('the first attempts are answered normally', statuses.slice(0, 20).every((s) => s === 401), statuses.slice(0, 3));
check('attempts past the limit are refused', statuses.slice(20).every((s) => s === 429), statuses.slice(20));

const refused = await login();
check('the refusal uses the standard error shape', refused.body.error?.code === 'too_many_requests', refused.body);
check('the response carries a RateLimit header', Boolean(refused.headers.get('ratelimit')), [
  ...refused.headers.keys(),
]);

// A different endpoint has its own budget, so one flood does not lock the app.
const health = await fetch(`${base}/api/health`);
check('an unrelated endpoint still works', health.status === 200, health.status);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
