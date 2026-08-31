/**
 * Verifies the models against a real MongoDB, without needing Atlas.
 * Run with: npm run check:models --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  UserModel,
  DoctorModel,
  AppointmentModel,
  RefreshTokenModel,
  QueueSessionModel,
  WaitlistModel,
} from '../src/models/index.js';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET ??= 'm'.repeat(48);
// connectDb() rather than mongoose.connect(): it applies the global mongoose
// settings the real server runs with, so the checks cannot pass on a
// configuration production never uses.
const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();
const { connectDb } = await import('../src/config/db.js');
await connectDb();

const results: string[] = [];
const check = (label: string, ok: boolean) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  return ok;
};

await Promise.all([
  UserModel.syncIndexes(),
  DoctorModel.syncIndexes(),
  AppointmentModel.syncIndexes(),
  RefreshTokenModel.syncIndexes(),
  QueueSessionModel.syncIndexes(),
  WaitlistModel.syncIndexes(),
]);

// --- the partial unique index actually exists ---
const indexes = await AppointmentModel.collection.indexes();
const slotIndex = indexes.find((i) => i.name === 'one_active_appointment_per_slot');
check('partial unique slot index created', Boolean(slotIndex?.unique && slotIndex.partialFilterExpression));

// --- passwordHash is not returned by default ---
const patient = await UserModel.create({
  name: 'Test Patient',
  email: 'Patient@Example.COM',
  passwordHash: 'not-a-real-hash',
  role: 'patient',
  dob: new Date('1994-02-01'),
});
const fetched = await UserModel.findById(patient._id);
check('passwordHash hidden by default', fetched?.get('passwordHash') === undefined);
check('passwordHash readable when selected', Boolean(await UserModel.findById(patient._id).select('+passwordHash').then((u) => u?.passwordHash)));
check('email lowercased on save', fetched?.email === 'patient@example.com');
check('age() computed from dob', (fetched as never as { age(): number }).age() >= 32);

// --- duplicate email rejected ---
let duplicateEmail = false;
try {
  await UserModel.create({ name: 'Impostor', email: 'patient@example.com', passwordHash: 'x', role: 'patient' });
} catch (e) {
  duplicateEmail = (e as { code?: number }).code === 11000;
}
check('duplicate email rejected', duplicateEmail);

// --- the slot rule ---
const doctorUser = await UserModel.create({ name: 'Dr Rao', email: 'rao@example.com', passwordHash: 'x', role: 'doctor' });
const doctor = await DoctorModel.create({
  userId: doctorUser._id,
  speciality: 'Cardiologist',
  degree: 'MBBS, MD',
  experience: 12,
  about: 'Cardiology',
  fees: 600,
  address: { line1: '12 Clinic Road' },
});

const slotStart = new Date('2026-09-01T09:00:00.000Z');
const base = {
  patientId: patient._id,
  doctorId: doctor._id,
  slotStart,
  slotEnd: new Date(slotStart.getTime() + 30 * 60_000),
  amount: 600,
  payment: { mode: 'cash' as const },
  docSnapshot: { name: 'Dr Rao', speciality: 'Cardiologist' as const, fees: 600 },
};

const first = await AppointmentModel.create({ ...base, tokenNumber: 1 });

let doubleBooked = false;
try {
  await AppointmentModel.create({ ...base, tokenNumber: 2 });
} catch (e) {
  doubleBooked = (e as { code?: number }).code === 11000;
}
check('second booking of the same slot rejected', doubleBooked);

// --- cancelling releases the slot ---
first.status = 'cancelled';
await first.save();
let rebooked = false;
try {
  await AppointmentModel.create({ ...base, tokenNumber: 2 });
  rebooked = true;
} catch {
  rebooked = false;
}
check('cancelled slot becomes bookable again', rebooked);

// --- a bad enum is rejected ---
let badEnum = false;
try {
  // Cast past the compiler on purpose: this checks the *database* rejects it, the
  // way an unvalidated request body would try to.
  const bogus = { ...doctor.toObject(), _id: undefined, userId: patient._id, speciality: 'Astrologer' };
  await DoctorModel.create(bogus as unknown as Parameters<typeof DoctorModel.create>[0]);
} catch (e) {
  badEnum = (e as Error).name === 'ValidationError';
}
check('unknown speciality rejected', badEnum);

// --- refresh tokens expire themselves ---
const refreshIndexes = await RefreshTokenModel.collection.indexes();
check(
  'refresh tokens have a TTL index',
  refreshIndexes.some((i) => i.expireAfterSeconds === 0 && i.key.expiresAt === 1),
);

// --- one queue session per doctor per day ---
const day = new Date('2026-09-01T00:00:00.000Z');
await QueueSessionModel.create({ doctorId: doctor._id, date: day });
let duplicateSession = false;
try {
  await QueueSessionModel.create({ doctorId: doctor._id, date: day });
} catch (e) {
  duplicateSession = (e as { code?: number }).code === 11000;
}
check('second queue session for the same day rejected', duplicateSession);

// --- one active waitlist entry per patient, but rejoining after leaving is fine ---
const waitEntry = await WaitlistModel.create({
  doctorId: doctor._id,
  patientId: patient._id,
  date: day,
  position: 1,
});
let duplicateWait = false;
try {
  await WaitlistModel.create({ doctorId: doctor._id, patientId: patient._id, date: day, position: 2 });
} catch (e) {
  duplicateWait = (e as { code?: number }).code === 11000;
}
check('second active waitlist entry rejected', duplicateWait);

waitEntry.state = 'withdrawn';
await waitEntry.save();
let rejoined = false;
try {
  await WaitlistModel.create({ doctorId: doctor._id, patientId: patient._id, date: day, position: 2 });
  rejoined = true;
} catch {
  rejoined = false;
}
check('can rejoin the waitlist after withdrawing', rejoined);

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();

process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
