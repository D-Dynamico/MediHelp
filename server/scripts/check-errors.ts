/**
 * Checks that failures become the responses the client expects, rather than
 * stack traces or bare 500s. Run with: npm run check:errors --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { AddressInfo } from 'node:net';
import { UserModel } from '../src/models/index.js';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/utils/apiError.js';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'x'.repeat(48);
// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();
await UserModel.syncIndexes();

const app = createApp();

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
};

const server = app.listen(0);
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

type Body = { error?: { code?: string; message?: string; details?: Record<string, string> } };
async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as Body;
  return { status: res.status, body };
}

// --- unmatched route ---
const missing = await call('/api/nope');
check(
  'unknown route returns 404 with a code',
  missing.status === 404 && missing.body.error?.code === 'not_found',
  missing,
);

// --- malformed json body ---
const badJson = await call('/api/health', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{ not json',
});
check(
  'malformed JSON returns 400 with a readable message',
  badJson.status === 400 && badJson.body.error?.code === 'bad_request',
  badJson,
);

// --- oversized body ---
const tooBig = await call('/api/health', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ blob: 'x'.repeat(200_000) }),
});
check(
  'oversized body returns 413, not 500',
  tooBig.status === 413 && tooBig.body.error?.code === 'payload_too_large',
  tooBig,
);

// --- the error shape itself ---
const built = ApiError.validation({ email: 'Enter a valid email address.' });
check(
  'validation errors carry per-field details',
  built.status === 422 &&
    built.toBody().error.details?.email === 'Enter a valid email address.',
);

const conflict = ApiError.conflict('taken');
check('conflict is 409', conflict.status === 409 && conflict.toBody().error.code === 'conflict');

// --- a duplicate key becomes a 409, not a 500 ---
await UserModel.create({ name: 'A', email: 'dupe@example.com', passwordHash: 'x', role: 'patient' });
let mapped = '';
try {
  await UserModel.create({ name: 'B', email: 'dupe@example.com', passwordHash: 'x', role: 'patient' });
} catch (error) {
  const { errorHandler } = await import('../src/middleware/error.js');
  await new Promise<void>((resolve) => {
    const res = {
      status(code: number) {
        mapped = String(code);
        return this;
      },
      json(body: { error: { message: string } }) {
        mapped += ` ${body.error.message}`;
        resolve();
        return this;
      },
    };
    errorHandler(
      error,
      { originalUrl: '/test', method: 'POST' } as never,
      res as never,
      (() => undefined) as never,
    );
  });
}
check(
  'duplicate email maps to 409 with a plain message',
  mapped.startsWith('409') && mapped.includes('already exists'),
  mapped,
);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
