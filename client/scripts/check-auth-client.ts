/**
 * Exercises the browser's side of auth — the axios instance, its refresh
 * interceptor and the single-flight guard — against the real server.
 *
 * The server runs in this process rather than as a subprocess: an earlier
 * version spawned it, and the in-memory database was torn down while the child
 * was still using it. Node also has no cookie jar, so this keeps one by hand,
 * which a browser would do for us.
 *
 * Run with: npm run check:auth:client --workspace client
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { api, setAccessToken, getAccessToken, setSessionLostHandler } from '../src/api/client';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'e'.repeat(48);
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';
// Short-lived on purpose: the point is to watch a token expire and the
// interceptor quietly replace it.
process.env.ACCESS_TOKEN_TTL = '1s';

const { createApp } = await import('../../server/src/app.js');
const { UserModel, RefreshTokenModel } = await import('../../server/src/models/index.js');

// connectDb() rather than mongoose.connect(), so the checks run with the same
// global mongoose settings as the real server.
const { assertThrowawayDatabase } = await import('../../server/scripts/_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../../server/src/config/db.js');
await connectDb();
await Promise.all([UserModel.syncIndexes(), RefreshTokenModel.syncIndexes()]);

const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

// --- point the app's axios instance at it, and give it a cookie jar -------
api.defaults.baseURL = `${base}/api`;

let jar = '';
api.interceptors.request.use((config) => {
  if (jar) config.headers.set('cookie', jar);
  return config;
});
api.interceptors.response.use((response) => {
  const setCookie = (response.headers as { 'set-cookie'?: string[] })['set-cookie'];
  const cookie = setCookie?.find((c) => c.startsWith('medihelp_refresh='));
  if (cookie) jar = cookie.split(';')[0]!;
  return response;
});

let sessionLost = 0;
setSessionLostHandler(() => {
  sessionLost += 1;
});

// --- register, which also opens a session --------------------------------
const registered = await api.post<{ user: { id: string }; accessToken: string }>('/auth/register', {
  name: 'Client Check',
  email: 'client@example.com',
  password: 'Password123!',
});
setAccessToken(registered.data.accessToken);
check('registering through the client works', Boolean(registered.data.accessToken));
check('the refresh cookie was set', jar.startsWith('medihelp_refresh='), jar.slice(0, 20));

const me = await api.get<{ user: { email: string } }>('/auth/me');
check('the token is attached to requests', me.data.user.email === 'client@example.com', me.data);

// --- the token expires and is replaced without the caller noticing -------
const firstToken = getAccessToken();
await sleep(1500); // the 1s token is now dead

const afterExpiry = await api.get<{ user: { email: string } }>('/auth/me');
check('a request after expiry still succeeds', afterExpiry.data.user.email === 'client@example.com');
check('the access token was quietly replaced', getAccessToken() !== firstToken);
check('the caller was never told the session was lost', sessionLost === 0, sessionLost);

// --- the single-flight guard ---------------------------------------------
// Five requests at once with a dead token. Without the guard each starts its own
// refresh; the server treats a replayed refresh token as theft, revokes the
// family, and signs the user out. This is the check that matters most here.
await sleep(1500);
const cookieBeforeBurst = jar;
const revoked = () => RefreshTokenModel.countDocuments({ revokedAt: { $exists: true } });
const revokedBeforeBurst = await revoked();

const burst = await Promise.allSettled([
  api.get('/auth/me'),
  api.get('/auth/me'),
  api.get('/auth/me'),
  api.get('/auth/me'),
  api.get('/auth/me'),
]);
check(
  'all five parallel requests succeed',
  burst.filter((r) => r.status === 'fulfilled').length === 5,
  burst.map((r) => r.status),
);
check('the session survived the burst', sessionLost === 0, sessionLost);
check('the cookie rotated during the burst', jar !== cookieBeforeBurst);

const revokedAfterBurst = await revoked();
check(
  'the burst spent exactly one refresh token, not five',
  revokedAfterBurst - revokedBeforeBurst === 1,
  { spent: revokedAfterBurst - revokedBeforeBurst },
);
check(
  'the session still works afterwards',
  (await api.get<{ user: { email: string } }>('/auth/me')).data.user.email === 'client@example.com',
);

// --- a genuinely dead session --------------------------------------------
await api.post('/auth/logout');
setAccessToken('not.a.real.token');
let rejected = false;
try {
  await api.get('/auth/me');
} catch {
  rejected = true;
}
check('a request with no valid session is rejected', rejected);
check('the app is told the session was lost', sessionLost === 1, sessionLost);
check('the stored token is cleared', getAccessToken() === null, getAccessToken());

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
