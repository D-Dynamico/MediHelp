/**
 * Every state change an admin or a doctor can make writes an audit row. This
 * drives each one over HTTP and checks the row: the right action, the right
 * target, the right actor. Refused actions must write nothing.
 *
 * Run with: npm run check:audit --workspace server
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'a'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { createApp } = await import('../src/app.js');
const { connectDb } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed.js');
const { AppointmentModel, AuditLogModel, DoctorModel, UserModel } = await import(
  '../src/models/index.js'
);
const { startOfDayUtc } = await import('../src/utils/dates.js');
const { UPLOAD_DIR } = await import('../src/providers/storage/local.js');

await connectDb();
await mongoose.connection.syncIndexes();
const seeded = await seedDatabase();

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function call(
  urlPath: string,
  options: { method?: string; body?: unknown; token?: string; form?: Record<string, string>; image?: Buffer } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: FormData | string | undefined;
  if (options.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.form)) form.append(key, value);
    if (options.image) {
      form.append('image', new Blob([new Uint8Array(options.image)], { type: 'image/png' }), 'photo.png');
    }
    body = form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${base}${urlPath}`, {
    method: options.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as any };
}

async function tokenFor(email: string, password = seeded.credentials.password) {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

type Actor = { id: string; role: 'admin' | 'doctor' };

/** The newest row for this action on this target, checked field by field. */
async function expectRow(label: string, action: string, targetId: string, actor: Actor) {
  const row = await AuditLogModel.findOne({ action, targetId }).sort({ createdAt: -1 }).lean();
  check(
    `${label} writes "${action}" by the ${actor.role}`,
    row !== null && String(row.actorId) === actor.id && row.actorRole === actor.role,
    row,
  );
  return row;
}

/* ------------------------------------------------------------ fixtures --- */

const adminUser = await UserModel.findOne({ email: seeded.credentials.admin });
const doctorUser = await UserModel.findOne({ email: seeded.credentials.doctor });
const doctor = await DoctorModel.findOne({ userId: doctorUser!._id });
const otherDoctor = await DoctorModel.findOne({ _id: { $ne: doctor!._id } });
const patient = await UserModel.findOne({ role: 'patient' });

const admin: Actor = { id: String(adminUser!._id), role: 'admin' };
const doc: Actor = { id: String(doctorUser!._id), role: 'doctor' };

const adminToken = await tokenFor(seeded.credentials.admin, seeded.credentials.adminPassword);
const doctorToken = await tokenFor(seeded.credentials.doctor);

// Written directly, all today, so the check does not depend on the seeded
// doctor working on the day it runs. The day is cleared first.
const today = startOfDayUtc();
await AppointmentModel.deleteMany({
  doctorId: { $in: [doctor!._id, otherDoctor!._id] },
  slotStart: { $gte: today, $lt: new Date(today.getTime() + 86_400_000) },
});

let nextToken = 1;
async function appointment(forDoctor = doctor!) {
  const token = nextToken++;
  const slotStart = new Date(today.getTime() + (8 + token) * 3_600_000);
  const row = await AppointmentModel.create({
    patientId: patient!._id,
    doctorId: forDoctor._id,
    slotStart,
    slotEnd: new Date(slotStart.getTime() + 20 * 60_000),
    tokenNumber: token,
    status: 'booked',
    amount: 500,
    payment: { mode: 'cash', status: 'pending_at_desk' },
    docSnapshot: { name: 'Fixture', speciality: forDoctor.speciality, fees: 500 },
  });
  return String(row._id);
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const uploaded: string[] = [];

/* ------------------------------------------------ the doctor's actions --- */

// The queue: check in, call, finish.
const queued = await appointment();
await call(`/api/doctor/queue/${queued}/check-in`, { method: 'POST', token: doctorToken });
await expectRow('checking a patient in', 'queue.check_in', queued, doc);

const called = await call('/api/doctor/queue/call-next', { method: 'POST', token: doctorToken });
const callRow = await AuditLogModel.findOne({ action: 'queue.call_next' }).lean();
check(
  'calling the next patient writes "queue.call_next" by the doctor, against their own record',
  called.status === 200 &&
    callRow !== null &&
    String(callRow.actorId) === doc.id &&
    String(callRow.targetId) === String(doctor!._id),
  { status: called.status, callRow },
);

await call(`/api/doctor/queue/${queued}/complete`, { method: 'POST', token: doctorToken });
await expectRow('finishing from the queue', 'appointment.complete', queued, doc);

const missed = await appointment();
await call(`/api/doctor/queue/${missed}/no-show`, { method: 'POST', token: doctorToken });
await expectRow('marking a no-show', 'appointment.no_show', missed, doc);

// The appointments table: start, finish, cancel.
const consult = await appointment();
await call(`/api/doctor/appointments/${consult}/start`, { method: 'PATCH', token: doctorToken });
await expectRow('starting a consult', 'appointment.start', consult, doc);
await call(`/api/doctor/appointments/${consult}/complete`, { method: 'PATCH', token: doctorToken });
await expectRow('finishing a consult', 'appointment.complete', consult, doc);

const dropped = await appointment();
await call(`/api/doctor/appointments/${dropped}/cancel`, { method: 'PATCH', token: doctorToken });
await expectRow('cancelling as the doctor', 'appointment.cancel', dropped, doc);

// Refused actions leave no trace: the trail says what happened, not what was tried.
const stranger = await appointment(otherDoctor!);
const before = await AuditLogModel.countDocuments();
const refused = await call(`/api/doctor/appointments/${stranger}/cancel`, {
  method: 'PATCH',
  token: doctorToken,
});
check(
  "a refused action (another doctor's appointment) writes no row",
  refused.status === 403 && (await AuditLogModel.countDocuments()) === before,
  { status: refused.status, rows: (await AuditLogModel.countDocuments()) - before },
);

// The profile. The form always sends every field, so the row must say what
// actually changed, not what was sent.
const doctorId = String(doctor!._id);
const aboutNow = doctor!.about!;
const feesNow = doctor!.fees;

await call('/api/doctor/profile', { method: 'PATCH', token: doctorToken, form: { about: aboutNow } });
const unchanged = await expectRow('saving the profile unchanged', 'doctor.profile.update', doctorId, doc);
check(
  'an unchanged save records no changed fields',
  JSON.stringify(unchanged?.meta) === JSON.stringify({ changed: [] }),
  unchanged?.meta,
);

await call('/api/doctor/profile', {
  method: 'PATCH',
  token: doctorToken,
  form: { about: aboutNow, fees: String(feesNow + 100) },
});
const repriced = await expectRow('changing the fee', 'doctor.profile.update', doctorId, doc);
check(
  'a fee change records the field and the before and after',
  JSON.stringify(repriced?.meta) ===
    JSON.stringify({ changed: ['fees'], fees: { from: feesNow, to: feesNow + 100 } }),
  repriced?.meta,
);

const photo = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: doctorToken,
  form: { about: aboutNow },
  image: PNG,
});
if (photo.body.profile?.image) uploaded.push(photo.body.profile.image);
const rephotographed = await expectRow('changing the photo', 'doctor.profile.update', doctorId, doc);
check(
  'a photo-only change is recorded as "photo"',
  JSON.stringify(rephotographed?.meta) === JSON.stringify({ changed: ['photo'] }),
  rephotographed?.meta,
);

/* ------------------------------------------------- the admin's actions --- */

const created = await call('/api/admin/doctors', {
  method: 'POST',
  token: adminToken,
  form: {
    name: 'Dr. Audit Trail',
    email: 'audit.trail@medihelp.test',
    password: 'FirstPass123!',
    speciality: 'Cardiologist',
    degree: 'MBBS, DM',
    experience: '9',
    about: 'Heart rhythm problems, blood pressure and post-surgical follow-up care.',
    fees: '900',
    addressLine1: '5 Hill Road',
    addressLine2: 'Bengaluru 560046',
  },
});
const newDoctorId = String(created.body.doctor?.id);
await expectRow('adding a doctor', 'doctor.create', newDoctorId, admin);

await call(`/api/admin/doctors/${newDoctorId}`, {
  method: 'PATCH',
  token: adminToken,
  form: { fees: '950', degree: 'MBBS, DM' },
});
const edited = await expectRow('editing a doctor', 'doctor.update', newDoctorId, admin);
check(
  "an admin edit records only what changed, with the fee's before and after",
  JSON.stringify(edited?.meta) === JSON.stringify({ changed: ['fees'], fees: { from: 900, to: 950 } }),
  edited?.meta,
);

await call(`/api/admin/doctors/${newDoctorId}`, { method: 'DELETE', token: adminToken });
await expectRow('removing a doctor', 'doctor.deactivate', newDoctorId, admin);

await call(`/api/admin/doctors/${newDoctorId}`, {
  method: 'PATCH',
  token: adminToken,
  form: { isActive: 'true' },
});
const reinstated = await expectRow('reinstating a doctor', 'doctor.update', newDoctorId, admin);
check(
  'reinstating is recorded as an isActive change',
  JSON.stringify(reinstated?.meta) === JSON.stringify({ changed: ['isActive'] }),
  reinstated?.meta,
);

const adminCancels = await appointment();
await call(`/api/admin/appointments/${adminCancels}/cancel`, { method: 'PATCH', token: adminToken });
await expectRow('cancelling as the admin', 'appointment.cancel', adminCancels, admin);

const adminCompletes = await appointment();
await call(`/api/admin/appointments/${adminCompletes}/complete`, { method: 'PATCH', token: adminToken });
await expectRow('completing as the admin', 'appointment.complete', adminCompletes, admin);

/* ------------------------------------------------------------ teardown --- */

for (const url of uploaded) {
  await fs.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true });
}

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
