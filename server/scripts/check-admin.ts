/**
 * Drives the admin panel over HTTP against a seeded throwaway database, so the
 * numbers on the dashboard are checked against rows that actually exist.
 *
 * Run with: npm run check:admin --workspace server
 *
 * A replica set rather than a single server: adding a doctor writes a `User` and
 * a `Doctor` in one transaction, and transactions need one.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'd'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { createApp } = await import('../src/app.js');
const { AppointmentModel, DoctorModel, UserModel } = await import('../src/models/index.js');
const { connectDb } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed.js');
const { UPLOAD_DIR } = await import('../src/providers/storage/local.js');

await connectDb();
await Promise.all([UserModel.syncIndexes(), DoctorModel.syncIndexes(), AppointmentModel.syncIndexes()]);
await seedDatabase();

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as Record<string, never>,
  };
}

async function tokenFor(email: string, password = 'Password123!') {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

const adminToken = await tokenFor('admin@medihelp.test');
const patientToken = await tokenFor('rahul@medihelp.test');

// --- the guards ----------------------------------------------------------
check('the dashboard needs a token', (await call('/api/admin/dashboard')).status === 401);
check(
  'a patient cannot read the dashboard',
  (await call('/api/admin/dashboard', { token: patientToken })).status === 403,
);

// --- the numbers ---------------------------------------------------------
const dash = await call('/api/admin/dashboard', { token: adminToken });
const body = dash.body as unknown as {
  counts: { doctors: number; patients: number; appointments: number };
  revenue: number;
  todayUpcoming: number;
  latestBookings: { id: string; patient: { name: string }; doctor: { name: string } }[];
};

check('an admin reads the dashboard', dash.status === 200, dash.status);

const [doctors, patients, appointments] = await Promise.all([
  UserModel.countDocuments({ role: 'doctor', isActive: true }),
  UserModel.countDocuments({ role: 'patient', isActive: true }),
  AppointmentModel.countDocuments(),
]);

check('the doctor count matches the database', body.counts.doctors === doctors, body.counts);
check('the patient count matches the database', body.counts.patients === patients, body.counts);
check(
  'the appointment count matches the database',
  body.counts.appointments === appointments,
  body.counts,
);

const paid = await AppointmentModel.aggregate<{ total: number }>([
  { $match: { 'payment.status': 'paid' } },
  { $group: { _id: null, total: { $sum: '$amount' } } },
]);
check('revenue is the sum of paid appointments', body.revenue === (paid[0]?.total ?? 0), body.revenue);
check('revenue counts only paid rows', body.revenue > 0, body.revenue);

const startOfToday = new Date();
startOfToday.setUTCHours(0, 0, 0, 0);
const startOfTomorrow = new Date(startOfToday);
startOfTomorrow.setUTCDate(startOfTomorrow.getUTCDate() + 1);
const upcoming = await AppointmentModel.countDocuments({
  slotStart: { $gte: startOfToday, $lt: startOfTomorrow },
  status: { $in: ['booked', 'checked_in', 'in_progress'] },
});
check("today's upcoming matches the database", body.todayUpcoming === upcoming, body.todayUpcoming);

check('the latest bookings are five at most', body.latestBookings.length === 5, body.latestBookings.length);
check(
  'each booking carries both names',
  body.latestBookings.every((row) => row.patient.name.length > 0 && row.doctor.name.length > 0),
  body.latestBookings[0],
);

// A cancelled appointment must not be counted as revenue or as upcoming.
const cancelled = await AppointmentModel.findOne({ status: 'cancelled' });
check('the seed includes a cancelled appointment to exclude', cancelled !== null);

/* ------------------------------------------------------- adding a doctor --- */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

const NEW_DOCTOR = {
  name: 'Dr. Priya Shah',
  email: 'priya.shah@medihelp.test',
  password: 'FirstPass123!',
  speciality: 'Cardiologist',
  degree: 'MBBS, DM',
  experience: '9',
  about: 'Heart rhythm problems, blood pressure and post-surgical follow-up care.',
  fees: '900',
  addressLine1: '5 Hill Road',
  addressLine2: 'Bengaluru 560046',
};

async function postDoctor(
  fields: Record<string, string>,
  options: { token?: string; image?: Buffer; imageType?: string } = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (options.image) {
    form.append(
      'image',
      new Blob([new Uint8Array(options.image)], { type: options.imageType ?? 'image/png' }),
      'photo.png',
    );
  }

  const response = await fetch(`${base}/api/admin/doctors`, {
    method: 'POST',
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    body: form,
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
}

check(
  'a patient cannot add a doctor',
  (await postDoctor(NEW_DOCTOR, { token: patientToken })).status === 403,
);

const before = await UserModel.countDocuments();
const bad = await postDoctor({ ...NEW_DOCTOR, speciality: 'Wizard', fees: 'free' }, { token: adminToken });
check('an unknown speciality is refused', bad.status === 422, bad.body);
check(
  'the refusal names both bad fields',
  Object.keys((bad.body as unknown as { error: { details: object } }).error.details).sort().join() ===
    'fees,speciality',
  bad.body,
);
check('a refused create writes nothing', (await UserModel.countDocuments()) === before);

const created = await postDoctor(NEW_DOCTOR, { token: adminToken, image: PNG });
const doctorDto = (created.body as unknown as { doctor: { id: string; name: string; image?: string; fees: number } }).doctor;
check('an admin adds a doctor', created.status === 201, created.body);
check('the new doctor carries the uploaded image', doctorDto.image?.startsWith('/uploads/') === true, doctorDto.image);
check('the fee arrived as a number, not a string', doctorDto.fees === 900, doctorDto.fees);

const savedUser = await UserModel.findOne({ email: NEW_DOCTOR.email });
const savedDoctor = await DoctorModel.findOne({ userId: savedUser?._id });
check('the login account was created', savedUser?.role === 'doctor');
check('the profile was created and is linked', savedDoctor !== null);
check('the dto id is the doctor id, not the user id', doctorDto.id === String(savedDoctor?._id));

// The point of the whole endpoint: the password the admin typed is the one that works.
const newLogin = await call('/api/auth/login', {
  method: 'POST',
  body: { email: NEW_DOCTOR.email, password: NEW_DOCTOR.password },
});
check('the new doctor can log in with the given password', newLogin.status === 200, newLogin.status);
check(
  'the new doctor has the doctor role',
  (newLogin.body as unknown as { user: { role: string } }).user.role === 'doctor',
);

const dashAfter = await call('/api/admin/dashboard', { token: adminToken });
check(
  'the dashboard doctor count went up by one',
  (dashAfter.body as unknown as { counts: { doctors: number } }).counts.doctors === doctors + 1,
);

// --- the transaction -----------------------------------------------------
const duplicate = await postDoctor(NEW_DOCTOR, { token: adminToken });
check('a duplicate email is a clean 409', duplicate.status === 409, duplicate.body);
check(
  'the duplicate left no second account behind',
  (await UserModel.countDocuments({ email: NEW_DOCTOR.email })) === 1,
);

// The failure the transaction exists for: the `User` is written, then the
// `Doctor` write blows up. Every field the endpoint accepts is valid to both
// schemas, so the only honest way to reach this is to break the second write on
// purpose. Without a transaction, what is left behind is an account that can log
// in, has no profile, and holds the email hostage.
const usersBefore = await UserModel.countDocuments();
const realCreate = DoctorModel.create.bind(DoctorModel);
DoctorModel.create = (() => Promise.reject(new Error('profile write failed'))) as never;

const halfway = await postDoctor({ ...NEW_DOCTOR, email: 'rollback@medihelp.test' }, { token: adminToken });
DoctorModel.create = realCreate as never;

check('a failed profile write is a 500, not a half-made doctor', halfway.status === 500, halfway.status);
check(
  'the login account was rolled back with it',
  (await UserModel.countDocuments({ email: 'rollback@medihelp.test' })) === 0,
);
check('no account was left behind at all', (await UserModel.countDocuments()) === usersBefore);
check(
  'the rolled-back email is free to use again',
  (await postDoctor({ ...NEW_DOCTOR, email: 'rollback@medihelp.test' }, { token: adminToken })).status === 201,
);

// --- a stranded upload ---------------------------------------------------
const strandedBefore = (await fs.readdir(UPLOAD_DIR).catch(() => [])).length;
const rejected = await postDoctor(
  { ...NEW_DOCTOR, email: 'stranded@medihelp.test', speciality: 'Wizard' },
  { token: adminToken, image: PNG },
);
check('a create with a bad field is refused', rejected.status === 422, rejected.status);
check(
  'the image from a refused create is not left behind',
  (await fs.readdir(UPLOAD_DIR).catch(() => [])).length === strandedBefore,
);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
