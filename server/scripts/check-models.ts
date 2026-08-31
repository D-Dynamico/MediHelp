/**
 * Verifies the models against a real MongoDB, without needing Atlas.
 * Run with: npm run check:models --workspace server
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { UserModel } from '../src/models/User.js';
import { DoctorModel } from '../src/models/Doctor.js';
import { AppointmentModel } from '../src/models/Appointment.js';

const mongod = await MongoMemoryServer.create();
await mongoose.connect(mongod.getUri(), { dbName: 'medihelp_check' });

const results: string[] = [];
const check = (label: string, ok: boolean) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  return ok;
};

await Promise.all([
  UserModel.syncIndexes(),
  DoctorModel.syncIndexes(),
  AppointmentModel.syncIndexes(),
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

console.log(`\n${results.join('\n')}\n`);

await mongoose.disconnect();
await mongod.stop();

process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
