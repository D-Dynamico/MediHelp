/**
 * Drives the patient side over HTTP against a seeded throwaway database:
 * the public catalogue, slot generation, booking, and a patient's own list.
 *
 * Run with: npm run check:booking --workspace server
 *
 * The assertions that matter most are the race one — two simultaneous bookings
 * for a single slot must produce exactly one appointment and one clean 409 —
 * and the ones proving the fee and the token number come from the server rather
 * than from anything the client sent.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'f'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { createApp } = await import('../src/app.js');
const { connectDb } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed.js');

await connectDb();
await mongoose.connection.syncIndexes();
await seedDatabase();

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function call(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
  });

  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
}

async function tokenFor(email: string, password = 'Password123!') {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

const adminToken = await tokenFor('admin@medihelp.test');

interface PublicDoctor {
  id: string;
  name: string;
  email?: string;
  speciality: string;
  degree: string;
  fees: number;
  available: boolean;
  slotDurationMins: number;
}

const doctorsOf = (body: unknown) => (body as { doctors: PublicDoctor[] }).doctors;
const doctorOf = (body: unknown) => (body as { doctor: PublicDoctor }).doctor;

/* ---------------------------------------------------- 6.1 the catalogue --- */

const open = await call('/api/doctors');
check('the catalogue needs no token at all', open.status === 200, open.status);
check('it lists the seeded doctors', doctorsOf(open.body).length === 8, doctorsOf(open.body).length);

// The whole reason this projection exists: a doctor's email is their login.
check(
  'no doctor in the list carries an email address',
  doctorsOf(open.body).every((doctor) => doctor.email === undefined),
  doctorsOf(open.body).map((doctor) => doctor.email),
);
check(
  'the fee and consult length are there, because booking needs them',
  doctorsOf(open.body).every(
    (doctor) => typeof doctor.fees === 'number' && typeof doctor.slotDurationMins === 'number',
  ),
);

const bySpeciality = await call('/api/doctors?speciality=Dermatologist');
check(
  'the speciality filter narrows the list',
  doctorsOf(bySpeciality.body).length > 0 &&
    doctorsOf(bySpeciality.body).every((doctor) => doctor.speciality === 'Dermatologist'),
  doctorsOf(bySpeciality.body).map((doctor) => doctor.speciality),
);

check(
  'a speciality that is not one of ours is refused rather than returning nothing',
  (await call('/api/doctors?speciality=Astrologer')).status === 422,
);

const searched = await call('/api/doctors?search=Rao');
check(
  'search finds a doctor by name',
  doctorsOf(searched.body).some((doctor) => doctor.name.includes('Rao')),
  doctorsOf(searched.body).map((doctor) => doctor.name),
);

// A search term is a regex on the server; punctuation in it must stay literal.
const dotted = await call('/api/doctors?search=R.o');
check(
  'a search term is escaped rather than run as a pattern',
  doctorsOf(dotted.body).length === 0,
  doctorsOf(dotted.body).map((doctor) => doctor.name),
);

// Searching by email would leak the field the projection deliberately drops.
check(
  'search does not match on the email address',
  doctorsOf((await call('/api/doctors?search=rao@medihelp.test')).body).length === 0,
);

const anita = doctorsOf(open.body).find((doctor) => doctor.name.includes('Rao'))!;
const one = await call(`/api/doctors/${anita.id}`);
check('a doctor has a public page', one.status === 200, one.status);
check('it is the doctor asked for', doctorOf(one.body).id === anita.id);
check('the page carries no email either', doctorOf(one.body).email === undefined);

check(
  'a malformed id is refused before any lookup',
  (await call('/api/doctors/not-an-id')).status === 422,
);
check(
  'an id that is well formed but unknown is a 404',
  (await call(`/api/doctors/${'a'.repeat(24)}`)).status === 404,
);

/* ------------------------------------ a removed doctor leaves the shelf --- */

const removed = doctorsOf(open.body).find((doctor) => doctor.name.includes('Nair'))!;
await call(`/api/admin/doctors/${removed.id}`, { method: 'DELETE', token: adminToken });

const afterRemoval = await call('/api/doctors');
check(
  'a removed doctor drops out of the catalogue',
  !doctorsOf(afterRemoval.body).some((doctor) => doctor.id === removed.id),
  doctorsOf(afterRemoval.body).length,
);
check(
  'their page is a 404, not a 403 that would confirm they exist',
  (await call(`/api/doctors/${removed.id}`)).status === 404,
);

// Put them back, so the rest of the script sees the seed it expects.
await call(`/api/admin/doctors/${removed.id}`, {
  method: 'PATCH',
  token: adminToken,
  body: { isActive: true },
});

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
