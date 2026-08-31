/**
 * Verifies the app against the real MongoDB Atlas cluster in your .env — the one
 * thing the in-memory checks cannot cover.
 *
 *   npm run check:atlas --workspace server           read-only: connect, inspect
 *   npm run check:atlas --workspace server -- --seed also seed, if it is empty
 *
 * Read-only by default on purpose: pointed at a database with real data, this
 * must not change anything unless you ask it to.
 */
import mongoose from 'mongoose';
import { getSettings } from '../src/config/env.js';
import { connectDb, disconnectDb, redactUri } from '../src/config/db.js';
import {
  AppointmentModel,
  DoctorModel,
  RefreshTokenModel,
  UserModel,
  WaitlistModel,
} from '../src/models/index.js';

const shouldSeed = process.argv.includes('--seed');

const results: string[] = [];
const check = (label: string, ok: boolean, note?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${note === undefined ? '' : `  (${String(note)})`}`);

let settings;
try {
  settings = getSettings();
} catch (error) {
  // A missing .env is the most likely reason to run this and get nothing, so
  // say what to do rather than printing a stack trace.
  console.error(`
${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
}

if (!settings.MONGODB_URI.startsWith('mongodb+srv://')) {
  console.log(
    `\n  MONGODB_URI is not an Atlas connection string.\n  Got: ${redactUri(settings.MONGODB_URI)}\n\n` +
      '  Atlas strings start with mongodb+srv://. Put yours in .env and run this again.\n',
  );
  process.exit(1);
}

// Placeholders straight out of Atlas's "Connect" dialog are the most common
// first-run mistake, so name them rather than letting the driver say "bad auth".
if (/<[^>]+>/.test(settings.MONGODB_URI)) {
  console.error(
    '\n  The connection string still has Atlas placeholders in it, like <db_username>.\n' +
      '  Replace them with your database user and password in .env, then run this again.\n',
  );
  process.exit(1);
}

console.log(`\n  Connecting to ${redactUri(settings.MONGODB_URI)}\n`);

try {
  await connectDb();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ${message}\n`);
  if (message.includes('bad auth')) {
    console.error(
      '  The cluster answered, so the hostname and network access are fine — it is the\n' +
        '  username or password. Check Atlas → Database Access, and remember that a\n' +
        '  password containing @ : / or ? must be percent-encoded in the URI.\n',
    );
  }
  process.exit(1);
}
check('connects to Atlas over mongodb+srv', mongoose.connection.readyState === 1);

const admin = mongoose.connection.db!.admin();
const info = (await admin.serverStatus()) as { version?: string };
check('server version is 6.0 or later', Number(info.version?.split('.')[0] ?? 0) >= 6, `v${info.version}`);
// 6.0+ matters: the two partial indexes below use $in inside their filter.

const dbName = mongoose.connection.name;
check('the connection string names a database', Boolean(dbName) && dbName !== 'test', dbName);

// --- indexes: the part a shared tier could plausibly refuse ---------------
await Promise.all([
  UserModel.syncIndexes(),
  DoctorModel.syncIndexes(),
  AppointmentModel.syncIndexes(),
  RefreshTokenModel.syncIndexes(),
  WaitlistModel.syncIndexes(),
]);

const appointmentIndexes = await AppointmentModel.collection.indexes();
const slotIndex = appointmentIndexes.find((i) => i.name === 'one_active_appointment_per_slot');
check(
  'the no-double-booking index exists on Atlas',
  Boolean(slotIndex?.unique && slotIndex.partialFilterExpression),
);

const waitlistIndexes = await WaitlistModel.collection.indexes();
check(
  'the one-active-waitlist-entry index exists on Atlas',
  waitlistIndexes.some((i) => i.name === 'one_active_waitlist_entry_per_patient' && i.unique),
);

const refreshIndexes = await RefreshTokenModel.collection.indexes();
check(
  'expired sessions clean themselves up (TTL index)',
  refreshIndexes.some((i) => i.expireAfterSeconds === 0),
);

// --- what is actually in there -------------------------------------------
const [users, doctors, appointments] = await Promise.all([
  UserModel.countDocuments(),
  DoctorModel.countDocuments(),
  AppointmentModel.countDocuments(),
]);

if (users === 0) {
  if (shouldSeed) {
    const { seedDatabase } = await import('../src/seed.js');
    const seeded = await seedDatabase();
    check('seeding an empty Atlas database works', seeded.doctors === 8, `${seeded.doctors} doctors`);
    console.log(`
  Seeded. Sign in with:
    admin    ${seeded.credentials.admin}  /  ${seeded.credentials.adminPassword}
    doctor   ${seeded.credentials.doctor}  /  ${seeded.credentials.password}
    patient  ${seeded.credentials.patient}  /  ${seeded.credentials.password}
`);
  } else {
    results.push('SKIP  the database is empty — re-run with --seed to fill it');
  }
} else {
  check('the database already has data', true, `${users} users, ${doctors} doctors, ${appointments} appointments`);
  results.push('SKIP  not seeding: this database is not empty (use `npm run seed -- --force` deliberately)');
}

// --- a real round trip ----------------------------------------------------
const probeEmail = `atlas-probe-${Date.now()}@medihelp.test`;
const probe = await UserModel.create({
  name: 'Atlas Probe',
  email: probeEmail,
  passwordHash: 'not-a-real-hash',
  role: 'patient',
});
const readBack = await UserModel.findById(probe._id);
check('writes and reads round-trip', readBack?.email === probeEmail);
check('the password field stays hidden on Atlas too', readBack?.get('passwordHash') === undefined);

let duplicateRejected = false;
try {
  await UserModel.create({ name: 'Dupe', email: probeEmail, passwordHash: 'x', role: 'patient' });
} catch (error) {
  duplicateRejected = (error as { code?: number }).code === 11000;
}
check('unique rules are enforced by Atlas', duplicateRejected);

await UserModel.deleteOne({ _id: probe._id });
check('the probe cleaned up after itself', (await UserModel.findById(probe._id)) === null);

console.log(`\n${results.join('\n')}\n`);

await disconnectDb();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
