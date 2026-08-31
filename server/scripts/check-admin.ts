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

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
