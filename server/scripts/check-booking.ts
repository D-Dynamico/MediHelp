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

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string; form?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: FormData | string | undefined;
  if (options.form) {
    // The profile endpoints are multipart, because they may carry a photo.
    const form = new FormData();
    for (const [key, value] of Object.entries(options.form)) form.append(key, value);
    body = form;
  } else if (options.body !== undefined) {
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

/** Midnight UTC today, the boundary the upcoming/past split uses. */
const startOfToday = new Date(new Date().toISOString().slice(0, 10)).getTime();

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

/**
 * The next day this doctor actually has times free.
 *
 * Scanned rather than fixed at "three days out": the doctor sits weekdays only,
 * so a fixed offset lands on a weekend one run in three and every check below it
 * fails for a reason that has nothing to do with booking.
 */
async function nextDayWithSlots(): Promise<string> {
  for (let ahead = 1; ahead <= 21; ahead += 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() + ahead);
    const date = day.toISOString().slice(0, 10);

    const body = (await call(`/api/doctors/${anita.id}/slots?date=${date}`)).body;
    if (slotsOf(body).some((slot) => slot.available)) return date;
  }

  throw new Error('No free slot in the next three weeks — the seed or the hours changed.');
}

const soonDate = await nextDayWithSlots();

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

/* --------------------------------------------------------- 6.3 booking --- */

interface Appointment {
  id: string;
  doctor: { id: string; name: string };
  patient: { id: string; name: string };
  slotStart: string;
  slotEnd: string;
  tokenNumber: number;
  status: string;
  amount: number;
  payment: { mode: string; status: string };
}

const apptOf = (body: unknown) => (body as { appointment: Appointment }).appointment;
const pageOf = (body: unknown) => body as { items: Appointment[]; total: number };

const rahulToken = await tokenFor('rahul@medihelp.test');
const snehaToken = await tokenFor('sneha@medihelp.test');
const anitaToken = await tokenFor('rao@medihelp.test');

/** A slot this doctor still has free on `soonDate`. */
async function freeSlot(): Promise<string> {
  const body = (await call(`/api/doctors/${anita.id}/slots?date=${soonDate}`)).body;
  const free = slotsOf(body).find((slot) => slot.available);
  if (!free) throw new Error(`No free slot left on ${soonDate} — earlier checks booked them all.`);
  return free.start;
}

check(
  'booking needs a token',
  (await call('/api/appointments', {
    method: 'POST',
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash' },
  })).status === 401,
);

check(
  'a doctor cannot book themselves in as a patient',
  (await call('/api/appointments', {
    method: 'POST',
    token: anitaToken,
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash' },
  })).status === 403,
);

check(
  'nor can an admin',
  (await call('/api/appointments', {
    method: 'POST',
    token: adminToken,
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash' },
  })).status === 403,
);

const wanted = await freeSlot();
const booked = await call('/api/appointments', {
  method: 'POST',
  token: rahulToken,
  // A fee and a token number are sent deliberately. Both must be ignored.
  body: { doctorId: anita.id, slotStart: wanted, mode: 'cash', amount: 1, tokenNumber: 999 },
});

check('a patient books a free slot', booked.status === 201, booked.body);
check('the appointment starts at the slot asked for', apptOf(booked.body).slotStart === wanted);
check(
  'the fee is the doctor\'s, not the one in the request',
  apptOf(booked.body).amount === anita.fees,
  { got: apptOf(booked.body).amount, fee: anita.fees },
);
check(
  'the token number is the server\'s, not the one in the request',
  apptOf(booked.body).tokenNumber !== 999 && apptOf(booked.body).tokenNumber >= 1,
  apptOf(booked.body).tokenNumber,
);
check('a cash booking is owed at the desk', apptOf(booked.body).payment.status === 'pending_at_desk');
check('the consult is one slot long',
  new Date(apptOf(booked.body).slotEnd).getTime() - new Date(wanted).getTime() ===
    anita.slotDurationMins * 60_000,
);

// The exit criterion, first half: the slot leaves the available list.
const afterBooking = slotsOf((await call(`/api/doctors/${anita.id}/slots?date=${soonDate}`)).body);
check(
  'the booked slot is no longer available',
  afterBooking.find((slot) => slot.start === wanted)?.available === false,
  afterBooking.find((slot) => slot.start === wanted),
);

// ...and shows up on both sides.
const mine = await call('/api/appointments/mine', { token: rahulToken });
check('it appears on the patient\'s own list',
  pageOf(mine.body).items.some((appointment) => appointment.id === apptOf(booked.body).id),
);
const doctorDay = await call('/api/doctor/appointments?when=all&pageSize=100', { token: anitaToken });
check('and on the doctor\'s',
  pageOf(doctorDay.body).items.some((appointment) => appointment.id === apptOf(booked.body).id),
);

/* ------------------------------------------- what booking refuses to do --- */

check(
  'the same slot cannot be booked twice',
  (await call('/api/appointments', {
    method: 'POST',
    token: snehaToken,
    body: { doctorId: anita.id, slotStart: wanted, mode: 'cash' },
  })).status === 409,
);

// Free is not the same question as offered: nothing occupies 03:17, and the
// doctor does not see patients then either.
const oddHour = `${soonDate}T03:17:00.000Z`;
check(
  'a time the doctor does not sit is refused even though nothing occupies it',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: oddHour, mode: 'cash' },
  })).status === 409,
);

const gone = new Date(Date.now() - 60 * 60 * 1000).toISOString();
check(
  'a time that has already passed is refused',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: gone, mode: 'cash' },
  })).status === 409,
);

const beyond = new Date();
beyond.setUTCDate(beyond.getUTCDate() + BOOKING_HORIZON_DAYS + 7);
check(
  'a time past the booking horizon is refused',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: beyond.toISOString(), mode: 'cash' },
  })).status === 409,
);

check(
  'a booking with no payment mode is refused',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: await freeSlot() },
  })).status === 422,
);

check(
  'a booking for an unknown doctor is a 404',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: 'a'.repeat(24), slotStart: await freeSlot(), mode: 'cash' },
  })).status === 404,
);

// A doctor who has stopped taking bookings cannot be booked by an old link.
await Doctors.updateOne({ _id: anitaId }, { $set: { available: false } });
check(
  'a doctor not taking bookings cannot be booked',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: wanted, mode: 'cash' },
  })).status === 409,
);
await Doctors.updateOne({ _id: anitaId }, { $set: { available: true } });

/* ---------------------- the exit criterion: two bookings, one slot, once --- */

const contested = await freeSlot();
const [first, second] = await Promise.all([
  call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: contested, mode: 'cash' },
  }),
  call('/api/appointments', {
    method: 'POST',
    token: snehaToken,
    body: { doctorId: anita.id, slotStart: contested, mode: 'razorpay' },
  }),
]);

const statuses = [first.status, second.status].sort((a, b) => a - b);
check(
  'two simultaneous bookings for one slot give one 201 and one 409',
  statuses[0] === 201 && statuses[1] === 409,
  { first: first.status, second: second.status, firstBody: first.body, secondBody: second.body },
);

const Appointments = mongoose.connection.collection('appointments');
const held = await Appointments.countDocuments({
  doctorId: anitaId,
  slotStart: new Date(contested),
  status: { $in: ['booked', 'checked_in', 'in_progress', 'completed'] },
});
check('exactly one appointment exists for that slot', held === 1, held);

/* -------------------------------------------- 6.4 a patient's own list --- */

check(
  'a patient cannot read the list without a token',
  (await call('/api/appointments/mine')).status === 401,
);
check(
  'a doctor has no patient list of their own',
  (await call('/api/appointments/mine', { token: anitaToken })).status === 403,
);

const upcoming = await call('/api/appointments/mine?when=upcoming', { token: rahulToken });
check('the upcoming list is the patient\'s own only',
  pageOf(upcoming.body).items.every((appointment) => appointment.patient.name === 'Rahul Verma'),
  pageOf(upcoming.body).items.map((appointment) => appointment.patient.name),
);
check('it reads soonest first',
  pageOf(upcoming.body).items.every(
    (appointment, i, all) => i === 0 || all[i - 1]!.slotStart <= appointment.slotStart,
  ),
);
check('nothing upcoming is in the past',
  pageOf(upcoming.body).items.every(
    (appointment) => new Date(appointment.slotStart).getTime() >= startOfToday,
  ),
);

const past = await call('/api/appointments/mine?when=past', { token: rahulToken });
check('the past list holds only what has been',
  pageOf(past.body).items.every(
    (appointment) => new Date(appointment.slotStart).getTime() < startOfToday,
  ),
);

/* ---------------------------------------------- cancelling one's own --- */

const toCancel = apptOf(booked.body).id;
check(
  "a patient cannot cancel another patient's appointment",
  (await call(`/api/appointments/${toCancel}/cancel`, { method: 'PATCH', token: snehaToken }))
    .status === 403,
);

const cancelled = await call(`/api/appointments/${toCancel}/cancel`, {
  method: 'PATCH',
  token: rahulToken,
});
check('a patient cancels their own', cancelled.status === 200, cancelled.body);
check('it is marked cancelled', apptOf(cancelled.body).status === 'cancelled');

// Cancelling releases the slot, because the unique index only covers the
// active statuses. This is the rule stated once and relied on everywhere.
const released = slotsOf((await call(`/api/doctors/${anita.id}/slots?date=${soonDate}`)).body);
check(
  'the cancelled slot is bookable again',
  released.find((slot) => slot.start === wanted)?.available === true,
  released.find((slot) => slot.start === wanted),
);
check(
  'and someone else can take it',
  (await call('/api/appointments', {
    method: 'POST',
    token: snehaToken,
    body: { doctorId: anita.id, slotStart: wanted, mode: 'cash' },
  })).status === 201,
);

check(
  'cancelling twice is refused rather than silently repeated',
  (await call(`/api/appointments/${toCancel}/cancel`, { method: 'PATCH', token: rahulToken }))
    .status === 409,
);

/* --------------------------------------------- 6.4 a patient's account --- */

interface PatientProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
  dob?: string;
  gender?: string;
}

const profileOf = (body: unknown) => (body as { profile: PatientProfile }).profile;

check('the account needs a token', (await call('/api/patient/profile')).status === 401);
check(
  'a doctor has no patient account of their own',
  (await call('/api/patient/profile', { token: anitaToken })).status === 403,
);

const account = await call('/api/patient/profile', { token: rahulToken });
check('a patient reads their own account', account.status === 200, account.status);
check('it is their own record', profileOf(account.body).email === 'rahul@medihelp.test');
check('the date of birth is a plain date, with no time on it',
  /^\d{4}-\d{2}-\d{2}$/.test(profileOf(account.body).dob ?? ''),
  profileOf(account.body).dob,
);
check('no password hash comes back with it',
  !Object.keys(profileOf(account.body)).some((key) => key.toLowerCase().includes('password')),
  Object.keys(profileOf(account.body)),
);

const edited = await call('/api/patient/profile', {
  method: 'PATCH',
  token: rahulToken,
  form: { phone: '9876500011', gender: 'male' },
});
check('a patient edits their own account', edited.status === 200, edited.body);
check('the phone number changed', profileOf(edited.body).phone === '9876500011');
check('the name was left alone', profileOf(edited.body).name === 'Rahul Verma');

// The email is the account identifier; changing it is a recovery flow of its
// own, so the field is simply not in the schema and zod drops it.
const smuggled = await call('/api/patient/profile', {
  method: 'PATCH',
  token: rahulToken,
  form: { email: 'someone-else@medihelp.test', role: 'admin', phone: '9876500012' },
});
check('an email in the body is ignored rather than applied',
  profileOf(smuggled.body).email === 'rahul@medihelp.test',
  profileOf(smuggled.body).email,
);
check('so is a role', profileOf(smuggled.body).role === 'patient', profileOf(smuggled.body).role);

check(
  'a birthday in the future is refused',
  (await call('/api/patient/profile', {
    method: 'PATCH',
    token: rahulToken,
    form: { dob: '2999-01-01' },
  })).status === 422,
);
check(
  'an edit that changes nothing is refused',
  (await call('/api/patient/profile', { method: 'PATCH', token: rahulToken, form: {} })).status ===
    422,
);

// One patient's edit must not touch another's record.
check(
  "the other patient's number is still their own",
  profileOf((await call('/api/patient/profile', { token: snehaToken })).body).phone !== '9876500011',
);

/* ------------------------------- clearing an optional detail --- */

// A patient may take a phone number, a birthday or a gender back off the
// account. An empty value means "clear it", which is a different thing from an
// absent one meaning "leave it alone" — the client used to drop empties before
// sending, so a field could never be unset once written.
const cleared = await call('/api/patient/profile', {
  method: 'PATCH',
  token: rahulToken,
  form: { phone: '', dob: '', gender: '' },
});
check('a patient may clear the optional details', cleared.status === 200, cleared.body);
check('the phone number is gone', !profileOf(cleared.body).phone, profileOf(cleared.body).phone);
check('the birthday is gone', !profileOf(cleared.body).dob, profileOf(cleared.body).dob);
check('the gender is gone', !profileOf(cleared.body).gender, profileOf(cleared.body).gender);

const reread = await call('/api/patient/profile', { token: rahulToken });
check('and stays gone when read back', !profileOf(reread.body).dob, profileOf(reread.body).dob);

const restored = await call('/api/patient/profile', {
  method: 'PATCH',
  token: rahulToken,
  form: { phone: '9876500011', dob: '1994-04-12', gender: 'male' },
});
check('they can be set again afterwards', profileOf(restored.body).dob === '1994-04-12', profileOf(restored.body).dob);

// The name is not optional, so an empty one is still a validation failure
// rather than a way to end up with a nameless account.
check(
  'an empty name is still refused',
  (await call('/api/patient/profile', { method: 'PATCH', token: rahulToken, form: { name: '' } }))
    .status === 422,
);

/* ------------------------------------- ids and dates that are not --- */

// Same length as an id but not hexadecimal. This used to reach the driver and
// throw a BSONError the error middleware does not know, so it came back as a
// 500 to an unauthenticated caller.
const notHex = await call(`/api/doctors/${'z'.repeat(24)}`);
check('a same-length non-hex id is a 422, not a 500', notHex.status === 422, notHex.status);
check(
  'and so is one on the slots endpoint',
  (await call(`/api/doctors/${'z'.repeat(24)}/slots?date=${soonDate}`)).status === 422,
);
check(
  'a real but unknown id is still a 404',
  (await call(`/api/doctors/${'0'.repeat(24)}`)).status === 404,
);

// A date that matches YYYY-MM-DD but names no real day. Month 13 parsed to an
// Invalid Date and threw out of the handler; 30 February silently rolled over
// and answered about 2 March instead.
check(
  'a thirteenth month is refused',
  (await call(`/api/doctors/${anita.id}/slots?date=2026-13-01`)).status === 422,
);
check(
  'so is the thirty-second of a month',
  (await call(`/api/doctors/${anita.id}/slots?date=2026-01-32`)).status === 422,
);
const feb30 = await call(`/api/doctors/${anita.id}/slots?date=2026-02-30`);
check('and so is the thirtieth of February', feb30.status === 422, feb30.status);
check(
  'a real leap day is still accepted',
  (await call(`/api/doctors/${anita.id}/slots?date=2028-02-29`)).status === 200,
);


console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
