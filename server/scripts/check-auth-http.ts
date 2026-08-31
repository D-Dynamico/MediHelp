/**
 * Drives the real app over HTTP: validation, cookies, guards, the whole
 * round trip a browser makes. Run with: npm run check:auth:http --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'c'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { createApp } = await import('../src/app.js');
const { UserModel, RefreshTokenModel, AuditLogModel } = await import('../src/models/index.js');
const { requireAuth, requireRole, requireOwnership, audit } = await import(
  '../src/middleware/auth.js'
);
const { hashPassword } = await import('../src/utils/password.js');
const { notFound, errorHandler } = await import('../src/middleware/error.js');

// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();
await Promise.all([UserModel.syncIndexes(), RefreshTokenModel.syncIndexes()]);

const app = createApp();

// The guards are middleware, so they get their own tiny app. Mounting test
// routes on the real one is not possible: createApp() ends with the 404 and
// error handlers, and express matches in registration order, so anything added
// afterwards is unreachable.
const guardApp = express();
guardApp.use(express.json());
guardApp.get('/admin-only', requireAuth, requireRole('admin'), (_req, res) => {
  res.json({ ok: true });
});
guardApp.get(
  '/owned/:ownerId',
  requireAuth,
  requireOwnership((req) => {
    const ownerId = String(req.params.ownerId);
    return Promise.resolve(ownerId === 'missing' ? null : ownerId);
  }),
  (_req, res) => {
    res.json({ ok: true });
  },
);
guardApp.post('/audited', requireAuth, async (req, res) => {
  await audit(req, 'test.action', { type: 'Test', id: req.auth!.userId });
  res.json({ ok: true });
});
guardApp.use(notFound);
guardApp.use(errorHandler);

const server = app.listen(0);
const guardServer = guardApp.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const guardBase = `http://127.0.0.1:${(guardServer.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

type Json = Record<string, unknown> & {
  user?: { id: string; role: string; email: string };
  accessToken?: string;
  error?: { code?: string; message?: string; details?: Record<string, string> };
};

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string; cookie?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;

  const origin = path.startsWith('/test') ? guardBase : base;
  const res = await fetch(`${origin}${path.replace(/^\/test/, '')}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : {}) as Json;
  return { status: res.status, body, setCookie: res.headers.getSetCookie() };
}

/** Pulls one cookie out of a Set-Cookie list, in the form a browser would send. */
function cookieFrom(setCookie: string[], name: string): string | undefined {
  const match = setCookie.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0];
}

// --- validation ----------------------------------------------------------
const badRegister = await call('/api/auth/register', {
  method: 'POST',
  body: { name: 'A', email: 'not-an-email', password: 'short' },
});
check('invalid input is a 422', badRegister.status === 422, badRegister.status);
check(
  'validation errors name each bad field',
  Boolean(badRegister.body.error?.details?.email && badRegister.body.error.details.password),
  badRegister.body.error?.details,
);

// --- registration --------------------------------------------------------
const registered = await call('/api/auth/register', {
  method: 'POST',
  body: {
    name: 'Nina Roy',
    email: 'nina@example.com',
    password: 'Password123!',
    role: 'admin',
    isActive: true,
  },
});
check('registering returns 201', registered.status === 201, registered.status);
check('extra fields are stripped, not obeyed', registered.body.user?.role === 'patient', registered.body.user?.role);
check('the access token comes back in the body', typeof registered.body.accessToken === 'string');
check('the refresh token never appears in the body', !JSON.stringify(registered.body).includes('refreshToken'));

// --- the refresh cookie's flags ------------------------------------------
const raw = registered.setCookie.find((c) => c.startsWith('medihelp_refresh=')) ?? '';
check('the refresh cookie is httpOnly', /HttpOnly/i.test(raw), raw);
check('the refresh cookie is sameSite=strict', /SameSite=Strict/i.test(raw), raw);
check('the refresh cookie is scoped to /api/auth', /Path=\/api\/auth/i.test(raw), raw);
check('the refresh cookie is not secure in development', !/Secure/i.test(raw), raw);

// --- guards --------------------------------------------------------------
const token = registered.body.accessToken!;
const cookie = cookieFrom(registered.setCookie, 'medihelp_refresh')!;

const noToken = await call('/api/auth/me');
check('a protected route without a token is 401', noToken.status === 401, noToken.status);

const badToken = await call('/api/auth/me', { token: 'not.a.token' });
check('a protected route with a bad token is 401', badToken.status === 401, badToken.status);

const me = await call('/api/auth/me', { token });
check('a valid token identifies the user', me.body.user?.email === 'nina@example.com', me.body);

const asPatient = await call('/test/admin-only', { token });
check('a patient is refused an admin route with 403', asPatient.status === 403, asPatient.status);

const ownThing = await call(`/test/owned/${registered.body.user!.id}`, { token });
check('the owner may act on their own resource', ownThing.status === 200, ownThing.status);

const otherThing = await call('/test/owned/000000000000000000000000', { token });
check(
  "a valid token cannot act on someone else's resource",
  otherThing.status === 403,
  otherThing.status,
);

const absent = await call('/test/owned/missing', { token });
check('a missing resource answers 404, not 403', absent.status === 404, absent.status);

// an admin passes the ownership check
await UserModel.create({
  name: 'Admin',
  email: 'admin@example.com',
  passwordHash: await hashPassword('Password123!'),
  role: 'admin',
});
const adminLogin = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'admin@example.com', password: 'Password123!' },
});
const adminToken = adminLogin.body.accessToken!;
const adminOnOther = await call('/test/owned/000000000000000000000000', { token: adminToken });
check("an admin may act on someone else's resource", adminOnOther.status === 200, adminOnOther.status);
check('an admin reaches an admin-only route', (await call('/test/admin-only', { token: adminToken })).status === 200);

// --- audit ---------------------------------------------------------------
await call('/test/audited', { method: 'POST', token });
const auditRow = await AuditLogModel.findOne({ action: 'test.action' });
check('audited actions write a row with the actor and role', auditRow?.actorRole === 'patient', auditRow?.actorRole);

// --- refresh over HTTP ---------------------------------------------------
const refreshed = await call('/api/auth/refresh', { method: 'POST', cookie });
check('refreshing with the cookie returns a new token', refreshed.status === 200 && Boolean(refreshed.body.accessToken));
const rotated = cookieFrom(refreshed.setCookie, 'medihelp_refresh')!;
check('refreshing sets a different cookie', rotated !== cookie);

const replay = await call('/api/auth/refresh', { method: 'POST', cookie });
check('replaying the old cookie is refused', replay.status === 401, replay.status);
check(
  'a refused refresh clears the cookie',
  replay.setCookie.some((c) => c.startsWith('medihelp_refresh=;')),
  replay.setCookie,
);
check(
  'the replay revoked the rotated cookie too',
  (await call('/api/auth/refresh', { method: 'POST', cookie: rotated })).status === 401,
);

const noCookie = await call('/api/auth/refresh', { method: 'POST' });
check('refreshing without a cookie is 401', noCookie.status === 401, noCookie.status);

// --- logout --------------------------------------------------------------
const fresh = await call('/api/auth/login', {
  method: 'POST',
  body: { email: 'nina@example.com', password: 'Password123!' },
});
const freshCookie = cookieFrom(fresh.setCookie, 'medihelp_refresh')!;
const loggedOut = await call('/api/auth/logout', { method: 'POST', cookie: freshCookie });
check('logout returns 204', loggedOut.status === 204, loggedOut.status);
check(
  'logout leaves the session unusable',
  (await call('/api/auth/refresh', { method: 'POST', cookie: freshCookie })).status === 401,
);

console.log(`\n${results.join('\n')}\n`);

server.close();
guardServer.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
