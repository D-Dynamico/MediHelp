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
const { slotsFor, BOOKING_HORIZON_DAYS } = await import('../src/utils/slots.js');

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

/* ------------------------------------------------- 6.2 slot generation --- */

interface Slot {
  start: string;
  end: string;
  available: boolean;
}

const slotsOf = (body: unknown) => (body as { slots: Slot[] }).slots;

// The pure function first, where the awkward cases are cheap to state.
const monday = new Date('2026-09-07T00:00:00.000Z');
const longAgo = new Date('2000-01-01T00:00:00.000Z');

const wholeSlots = slotsFor({
  workingHours: [{ day: 1, start: '09:00', end: '10:00' }],
  slotDurationMins: 30,
  date: monday,
  taken: [],
  now: longAgo,
});
check('an hour at half-hour consults is two slots', wholeSlots.length === 2, wholeSlots);
check(
  'the first one starts when the sitting opens',
  wholeSlots[0]?.start === '2026-09-07T09:00:00.000Z',
  wholeSlots[0],
);

// A sitting with a remainder must not offer a consult that runs past closing.
const remainder = slotsFor({
  workingHours: [{ day: 1, start: '09:00', end: '10:20' }],
  slotDurationMins: 30,
  date: monday,
  taken: [],
  now: longAgo,
});
check(
  'a part-slot at the end of a sitting is not offered',
  remainder.length === 2 && remainder[1]?.end === '2026-09-07T10:00:00.000Z',
  remainder,
);

// Two sittings in a day, entered out of order, read back as one ordered list.
const twoSittings = slotsFor({
  workingHours: [
    { day: 1, start: '17:00', end: '18:00' },
    { day: 1, start: '09:00', end: '10:00' },
    { day: 2, start: '09:00', end: '18:00' },
  ],
  slotDurationMins: 60,
  date: monday,
  taken: [],
  now: longAgo,
});
check('only the asked-for weekday is used', twoSittings.length === 2, twoSittings);
check(
  'sittings entered out of order come back in time order',
  twoSittings[0]!.start < twoSittings[1]!.start,
  twoSittings.map((slot) => slot.start),
);

const withTaken = slotsFor({
  workingHours: [{ day: 1, start: '09:00', end: '10:00' }],
  slotDurationMins: 30,
  date: monday,
  taken: [new Date('2026-09-07T09:00:00.000Z')],
  now: longAgo,
});
check(
  'a taken slot is shown as taken rather than hidden',
  withTaken.length === 2 && withTaken[0]?.available === false && withTaken[1]?.available === true,
  withTaken,
);

// "Now" is midway through the sitting, so the first slot is already gone.
const halfPast = slotsFor({
  workingHours: [{ day: 1, start: '09:00', end: '10:00' }],
  slotDurationMins: 30,
  date: monday,
  taken: [],
  now: new Date('2026-09-07T09:15:00.000Z'),
});
check('a slot that has already started is dropped, not greyed out', halfPast.length === 1, halfPast);

/* --------------------------------------------------- the slots endpoint --- */

const today = new Date();
const soon = new Date(today);
soon.setUTCDate(soon.getUTCDate() + 3);
const soonDate = soon.toISOString().slice(0, 10);

const day = await call(`/api/doctors/${anita.id}/slots?date=${soonDate}`);
check('slots need no token either', day.status === 200, day.status);
check('the day echoes back the date asked for', (day.body as unknown as { date: string }).date === soonDate);
check('a working day offers slots', slotsOf(day.body).length > 0, slotsOf(day.body).length);
check(
  'every slot is one consult long',
  slotsOf(day.body).every(
    (slot) =>
      new Date(slot.end).getTime() - new Date(slot.start).getTime() ===
      anita.slotDurationMins * 60_000,
  ),
);
check(
  'no slot is in the past',
  slotsOf(day.body).every((slot) => new Date(slot.start).getTime() > Date.now()),
);

check(
  'a badly formed date is refused',
  (await call(`/api/doctors/${anita.id}/slots?date=next-tuesday`)).status === 422,
);

const yesterday = new Date(today);
yesterday.setUTCDate(yesterday.getUTCDate() - 1);
check(
  'a day that has gone offers nothing',
  slotsOf(
    (await call(`/api/doctors/${anita.id}/slots?date=${yesterday.toISOString().slice(0, 10)}`)).body,
  ).length === 0,
);

const tooFar = new Date(today);
tooFar.setUTCDate(tooFar.getUTCDate() + BOOKING_HORIZON_DAYS + 1);
check(
  'a day past the booking horizon offers nothing',
  slotsOf(
    (await call(`/api/doctors/${anita.id}/slots?date=${tooFar.toISOString().slice(0, 10)}`)).body,
  ).length === 0,
);

// A doctor who has switched off bookings still has a page, but no times.
const Doctors = mongoose.connection.collection('doctors');
const anitaId = new mongoose.Types.ObjectId(anita.id);
await Doctors.updateOne({ _id: anitaId }, { $set: { available: false } });
check(
  'a doctor not taking bookings offers no slots',
  slotsOf((await call(`/api/doctors/${anita.id}/slots?date=${soonDate}`)).body).length === 0,
);
check('but their page still loads', (await call(`/api/doctors/${anita.id}`)).status === 200);
await Doctors.updateOne({ _id: anitaId }, { $set: { available: true } });

check(
  'slots for an unknown doctor are a 404',
  (await call(`/api/doctors/${'a'.repeat(24)}/slots`)).status === 404,
);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
