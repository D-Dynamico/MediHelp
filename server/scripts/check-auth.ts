/**
 * Checks the auth service: registration, login, lockout, rotation and reuse
 * detection. Run with: npm run check:auth --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'b'.repeat(48);
process.env.LOG_LEVEL = 'error';

const auth = await import('../src/modules/auth/auth.service.js');
const { UserModel, RefreshTokenModel } = await import('../src/models/index.js');
const { verifyAccessToken } = await import('../src/utils/tokens.js');

// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();
await UserModel.syncIndexes();
await RefreshTokenModel.syncIndexes();

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

const ctx = { ip: '127.0.0.1', ua: 'check-script' };

/** Runs something that should fail and reports the status it failed with. */
const statusOf = async (fn: () => Promise<unknown>): Promise<number | string> => {
  try {
    await fn();
    return 'no error';
  } catch (error) {
    return (error as { status?: number }).status ?? 500;
  }
};

// --- registration --------------------------------------------------------
const registered = await auth.register(
  { name: 'Asha Patel', email: 'Asha@Example.com', password: 'Password123!' },
  ctx,
);
check('registering returns a session', Boolean(registered.accessToken && registered.refreshToken));
check('registration creates a patient', registered.user.role === 'patient', registered.user.role);
check('the email is normalised', registered.user.email === 'asha@example.com', registered.user.email);
check('the returned user carries no password field', !('passwordHash' in registered.user));

// A client trying to make itself an admin: `role` is simply never read.
const claimed = await auth.register(
  {
    name: 'Sneaky',
    email: 'sneaky@example.com',
    password: 'Password123!',
    ...({ role: 'admin' } as object),
  },
  ctx,
);
check('a client cannot register itself as an admin', claimed.user.role === 'patient', claimed.user.role);

check(
  'registering a taken email is a 409',
  (await statusOf(() =>
    auth.register({ name: 'A', email: 'asha@example.com', password: 'Password123!' }, ctx),
  )) === 409,
);

// --- login ---------------------------------------------------------------
const loggedIn = await auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx);
check('login succeeds with the right password', Boolean(loggedIn.accessToken));
check(
  'the access token identifies the user',
  verifyAccessToken(loggedIn.accessToken).sub === registered.user.id,
);
check(
  'login is case-insensitive on the email',
  Boolean((await auth.login({ email: 'ASHA@example.com', password: 'Password123!' }, ctx)).accessToken),
);

const wrongPassword = await statusOf(() =>
  auth.login({ email: 'asha@example.com', password: 'wrong' }, ctx),
);
const unknownEmail = await statusOf(() =>
  auth.login({ email: 'nobody@example.com', password: 'whatever' }, ctx),
);
check('the wrong password is a 401', wrongPassword === 401, wrongPassword);
check('an unknown email is also a 401, not a 404', unknownEmail === 401, unknownEmail);

// --- lockout -------------------------------------------------------------
const lockTarget = await auth.register(
  { name: 'Lock Me', email: 'lock@example.com', password: 'Password123!' },
  ctx,
);
for (let attempt = 0; attempt < 6; attempt += 1) {
  await statusOf(() => auth.login({ email: 'lock@example.com', password: 'nope' }, ctx));
}
const locked = await statusOf(() =>
  auth.login({ email: 'lock@example.com', password: 'Password123!' }, ctx),
);
check('six failures lock the account', locked === 429, locked);
check(
  'the lock holds even against the correct password',
  (await statusOf(() => auth.login({ email: 'lock@example.com', password: 'Password123!' }, ctx))) === 429,
);
check(
  'the lock expires rather than being permanent',
  Boolean((await UserModel.findById(lockTarget.user.id))?.lockUntil),
);

await UserModel.updateOne(
  { _id: lockTarget.user.id },
  { $unset: { lockUntil: 1 }, $set: { failedLogins: 3 } },
);
await auth.login({ email: 'lock@example.com', password: 'Password123!' }, ctx);
check(
  'a successful login resets the failure count',
  (await UserModel.findById(lockTarget.user.id))?.failedLogins === 0,
);

// --- rotation ------------------------------------------------------------
const first = await auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx);
const second = await auth.refresh(first.refreshToken, ctx);
check('refreshing issues a new refresh token', second.refreshToken !== first.refreshToken);
check(
  'refreshing issues a working access token',
  verifyAccessToken(second.accessToken).sub === registered.user.id,
);

const firstRow = await RefreshTokenModel.findOne({ replacedBy: { $exists: true } });
check('the rotated token is marked revoked', Boolean(firstRow?.revokedAt));
check('the rotated token records its replacement', Boolean(firstRow?.replacedBy));

// --- reuse detection -----------------------------------------------------
const third = await auth.refresh(second.refreshToken, ctx);
const replay = await statusOf(() => auth.refresh(second.refreshToken, ctx));
check('replaying an already-used refresh token is rejected', replay === 401, replay);

const afterReplay = await statusOf(() => auth.refresh(third.refreshToken, ctx));
check(
  'the replay revokes the whole family, including the live token',
  afterReplay === 401,
  afterReplay,
);
check(
  'a fresh login still works after a family is revoked',
  Boolean((await auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx)).accessToken),
);

// --- logout --------------------------------------------------------------
const deviceA = await auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx);
const deviceB = await auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx);
await auth.logout(deviceA.refreshToken);
check(
  'a logged-out token cannot refresh',
  (await statusOf(() => auth.refresh(deviceA.refreshToken, ctx))) === 401,
);
check(
  'logging out one device leaves the other signed in',
  Boolean((await auth.refresh(deviceB.refreshToken, ctx)).accessToken),
);

await auth.logoutEverywhere(registered.user.id);
check(
  'signing out everywhere ends every session',
  (await RefreshTokenModel.countDocuments({
    userId: registered.user.id,
    revokedAt: { $exists: false },
  })) === 0,
);

// --- deactivated accounts ------------------------------------------------
await UserModel.updateOne({ _id: registered.user.id }, { $set: { isActive: false } });
check(
  'a deactivated account cannot log in',
  (await statusOf(() => auth.login({ email: 'asha@example.com', password: 'Password123!' }, ctx))) === 401,
);

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
