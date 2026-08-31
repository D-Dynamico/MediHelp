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

// Imported after the env is set, because settings parse on first use.
const { seedDatabase } = await import('../src/seed.js');

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

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
