/**
 * Runs the real seed against a throwaway MongoDB and checks what it produced.
 * Run with: npm run check:seed --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { AppointmentModel, DoctorModel, UserModel } from '../src/models/index.js';
import { verifyPassword } from '../src/utils/password.js';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.LOG_LEVEL = 'warn';
// The developer's own .env must not decide what this check sees: the password
// gate below asserts on the exact fallbacks.
process.env.NODE_ENV = 'development';
delete process.env.SEED_ADMIN_PASSWORD;
delete process.env.SEED_DEMO_PASSWORD;

// Imported after the env is set, because settings parse on first use.
const { seedDatabase } = await import('../src/seed.js');

// That import is what loads .env, so clear the seed passwords again — dotenv
// only fills keys that are absent, and they were absent a moment ago.
delete process.env.SEED_ADMIN_PASSWORD;
delete process.env.SEED_DEMO_PASSWORD;

// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

// --- first run, on an empty database ---
const seeded = await seedDatabase();
check('seeds an empty database', seeded.doctors === 8 && seeded.patients === 5, seeded);
check(
  'reports credentials to sign in with',
  Boolean(seeded.credentials.admin && seeded.credentials.doctor && seeded.credentials.patient),
  seeded.credentials,
);

const [admins, doctorUsers, patients, doctors, appointments] = await Promise.all([
  UserModel.countDocuments({ role: 'admin' }),
  UserModel.countDocuments({ role: 'doctor' }),
  UserModel.countDocuments({ role: 'patient' }),
  DoctorModel.countDocuments(),
  AppointmentModel.countDocuments(),
]);

check('one admin created', admins === 1, admins);
check('eight doctors, each with a profile', doctorUsers === 8 && doctors === 8, { doctorUsers, doctors });
check('five patients created', patients === 5, patients);
check('twelve appointments created', appointments === 12, appointments);

const specialities = await DoctorModel.distinct('speciality');
check('doctors cover all eight specialities', specialities.length === 8, specialities.length);

// --- passwords ---
const admin = await UserModel.findOne({ role: 'admin' }).select('+passwordHash');
check('passwords are stored hashed', Boolean(admin?.passwordHash?.startsWith('$2')), admin?.passwordHash?.slice(0, 4));
check('the reported password actually signs in', await verifyPassword(seeded.credentials.adminPassword, admin?.passwordHash ?? ''));
check('the password is not stored in plain text', admin?.passwordHash !== seeded.credentials.adminPassword);

// --- the data is worth looking at ---
const completed = await AppointmentModel.countDocuments({ status: 'completed' });
const upcoming = await AppointmentModel.countDocuments({ slotStart: { $gte: new Date() } });
check('there is completed history for the earnings view', completed >= 3, completed);
check('there are upcoming appointments to act on', upcoming >= 3, upcoming);

const done = await AppointmentModel.findOne({ status: 'completed' });
check(
  'appointments carry a fee snapshot matching the amount',
  (done?.docSnapshot?.fees ?? 0) > 0 && done?.amount === done?.docSnapshot?.fees,
  { amount: done?.amount, snapshot: done?.docSnapshot?.fees },
);

const withHours = await DoctorModel.findOne();
check('doctors have working hours for slot generation', (withHours?.workingHours?.length ?? 0) === 10, withHours?.workingHours?.length);

// --- the guard ---
let refused = '';
try {
  await seedDatabase();
} catch (error) {
  refused = error instanceof Error ? error.message : String(error);
}
check('re-seeding a populated database is refused', refused.includes('already has'), refused.slice(0, 120));
check('the refusal explains how to override', refused.includes('--force'), refused.slice(0, 120));
check('nothing was deleted by the refused run', (await UserModel.countDocuments()) === 14);

const reseeded = await seedDatabase({ force: true });
check('--force re-seeds', reseeded.doctors === 8);
check('--force leaves exactly one set of data', (await UserModel.countDocuments()) === 14);

// --- production refuses the well-known demo password ---
// The seed creates an admin and eight doctors. In development they share a
// password printed in this repo, which is the point; in production that would be
// a way in, so the seed must refuse rather than fall back.
const { reloadSettings } = await import('../src/config/env.js');

async function seedAs(
  env: Record<string, string | undefined>,
): Promise<{ error: string; users: number }> {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
    SEED_DEMO_PASSWORD: process.env.SEED_DEMO_PASSWORD,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  reloadSettings();

  let error = '';
  try {
    await seedDatabase({ force: true });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const users = await UserModel.countDocuments();

  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  reloadSettings();
  return { error, users };
}

const noPasswords = await seedAs({
  NODE_ENV: 'production',
  SEED_ADMIN_PASSWORD: undefined,
  SEED_DEMO_PASSWORD: undefined,
});
check(
  'production seeding is refused when no passwords are set',
  noPasswords.error.includes('Refusing to seed production'),
  noPasswords.error.slice(0, 160),
);
check(
  'the refusal names both keys to set',
  noPasswords.error.includes('SEED_ADMIN_PASSWORD') &&
    noPasswords.error.includes('SEED_DEMO_PASSWORD'),
  noPasswords.error.slice(0, 160),
);
check(
  'the refused production seed deleted nothing',
  noPasswords.users === 14,
  noPasswords.users,
);

const halfSet = await seedAs({
  NODE_ENV: 'production',
  SEED_ADMIN_PASSWORD: 'a-strong-admin-password',
  SEED_DEMO_PASSWORD: undefined,
});
check(
  'production seeding is refused when only the admin password is set',
  halfSet.error.includes('SEED_DEMO_PASSWORD') && !halfSet.error.includes('SEED_ADMIN_PASSWORD'),
  halfSet.error.slice(0, 160),
);

const demoReused = await seedAs({
  NODE_ENV: 'production',
  SEED_ADMIN_PASSWORD: 'Password123!',
  SEED_DEMO_PASSWORD: 'a-strong-demo-password',
});
check(
  'production seeding is refused when a password is the demo one from the repo',
  demoReused.error.includes('demo password from this repo'),
  demoReused.error.slice(0, 160),
);

const productionOk = await seedAs({
  NODE_ENV: 'production',
  SEED_ADMIN_PASSWORD: 'a-strong-admin-password',
  SEED_DEMO_PASSWORD: 'a-strong-demo-password',
});
check('production seeding succeeds once both are set', productionOk.error === '', productionOk.error);

const productionAdmin = await UserModel.findOne({ role: 'admin' }).select('+passwordHash');
const productionDoctor = await UserModel.findOne({ role: 'doctor' }).select('+passwordHash');
check(
  'the admin password set in the environment is the one that signs in',
  await verifyPassword('a-strong-admin-password', productionAdmin?.passwordHash ?? ''),
);
check(
  'seeded doctors use the demo password from the environment, not the repo one',
  (await verifyPassword('a-strong-demo-password', productionDoctor?.passwordHash ?? '')) &&
    !(await verifyPassword('Password123!', productionDoctor?.passwordHash ?? '')),
);

// Back to a development seed, so anything added below sees the usual fixture.
const devAgain = await seedDatabase({ force: true });
check('development still falls back to the demo password', devAgain.credentials.password === 'Password123!', devAgain.credentials.password);

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
