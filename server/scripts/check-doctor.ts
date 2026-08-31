/**
 * Drives the doctor dashboard over HTTP against a seeded throwaway database.
 *
 * Run with: npm run check:doctor --workspace server
 *
 * The assertions that matter most are the ownership ones: a doctor holding a
 * perfectly valid token must not be able to reach another doctor's appointment
 * by putting its id in the URL.
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

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string; form?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: FormData | string | undefined;
  if (options.form) {
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

const anitaToken = await tokenFor('rao@medihelp.test');
const meeraToken = await tokenFor('nair@medihelp.test');
const adminToken = await tokenFor('admin@medihelp.test');
const patientToken = await tokenFor('rahul@medihelp.test');

type Profile = {
  id: string;
  name: string;
  email: string;
  speciality: string;
  degree: string;
  experience: number;
  fees: number;
  about: string;
  address: { line1: string; line2?: string };
  available: boolean;
  slotDurationMins: number;
  workingHours: { day: number; start: string; end: string }[];
  medianConsultMins: number;
};
const profileOf = (body: unknown) => (body as { profile: Profile }).profile;

/* ------------------------------------------------------------ 5.1 profile --- */

check('the profile needs a token', (await call('/api/doctor/profile')).status === 401);
check(
  'a patient cannot read a doctor profile',
  (await call('/api/doctor/profile', { token: patientToken })).status === 403,
);
check(
  'an admin is not treated as a doctor here',
  (await call('/api/doctor/profile', { token: adminToken })).status === 403,
);

const mine = await call('/api/doctor/profile', { token: anitaToken });
check('a doctor reads their own profile', mine.status === 200, mine.status);
check('it is their own record', profileOf(mine.body).email === 'rao@medihelp.test', profileOf(mine.body).email);
check('the profile carries the working hours', profileOf(mine.body).workingHours.length === 10);
check(
  'the profile carries the learned consult length',
  typeof profileOf(mine.body).medianConsultMins === 'number',
);

const edited = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: anitaToken,
  form: { fees: '650', about: 'General practice, chronic illness reviews and travel vaccinations.' },
});
check('a doctor edits their own profile', edited.status === 200, edited.body);
check('the fee changed', profileOf(edited.body).fees === 650, profileOf(edited.body).fees);
check(
  'a field the edit did not name is untouched',
  profileOf(edited.body).address.line1 === profileOf(mine.body).address.line1,
);
check(
  'the speciality is not editable by the doctor',
  profileOf(edited.body).speciality === profileOf(mine.body).speciality,
);

// The credentials belong to the clinic, not to the account holder. An attempt to
// change them is stripped by the schema rather than refused, because the field
// simply is not part of the contract.
const credentials = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: anitaToken,
  form: { speciality: 'Neurologist', degree: 'PhD', experience: '40', fees: '650' },
});
check('smuggled credential fields are ignored', credentials.status === 200, credentials.body);
const afterSmuggle = profileOf(credentials.body);
check('the speciality did not change', afterSmuggle.speciality === profileOf(mine.body).speciality);
check('the degree did not change', afterSmuggle.degree === profileOf(mine.body).degree);
check('the experience did not change', afterSmuggle.experience === profileOf(mine.body).experience);

check(
  'an edit that changes nothing is refused',
  (await call('/api/doctor/profile', { method: 'PATCH', token: anitaToken, form: {} })).status === 422,
);
check(
  'a negative fee is refused',
  (await call('/api/doctor/profile', { method: 'PATCH', token: anitaToken, form: { fees: '-1' } }))
    .status === 422,
);

// One doctor's edit must not touch another's record.
const meeraBefore = profileOf((await call('/api/doctor/profile', { token: meeraToken })).body);
check('a second doctor sees a different record', meeraBefore.email === 'nair@medihelp.test');
check('the first doctor\'s edit left the second alone', meeraBefore.fees !== 650, meeraBefore.fees);

/* ------------------------------------------------------- 5.2 availability --- */

const hours = (windows: { day: number; start: string; end: string }[]) =>
  call('/api/doctor/profile', {
    method: 'PATCH',
    token: anitaToken,
    form: { workingHours: JSON.stringify(windows) },
  });

const detailsOf = (body: unknown) =>
  (body as { error?: { details?: Record<string, string> } }).error?.details ?? {};

const goodGrid = [
  { day: 1, start: '09:00', end: '13:00' },
  { day: 1, start: '16:00', end: '19:00' },
  { day: 3, start: '10:00', end: '14:00' },
];
const saved = await hours(goodGrid);
check('a sensible grid is accepted', saved.status === 200, saved.body);
check('the grid came back as saved', profileOf(saved.body).workingHours.length === 3, profileOf(saved.body).workingHours);

// Touching windows are one long day, not a clash.
const touching = await hours([
  { day: 2, start: '09:00', end: '13:00' },
  { day: 2, start: '13:00', end: '17:00' },
]);
check('back-to-back sittings are allowed', touching.status === 200, touching.body);

const backwards = await hours([{ day: 1, start: '17:00', end: '09:00' }]);
check('a sitting that ends before it starts is refused', backwards.status === 422, backwards.status);
check(
  'the refusal names the day and the row',
  String(detailsOf(backwards.body)['workingHours.0']).includes('Monday'),
  detailsOf(backwards.body),
);

const zeroLength = await hours([{ day: 1, start: '09:00', end: '09:00' }]);
check('a zero-length sitting is refused', zeroLength.status === 422, zeroLength.status);

const tooShort = await hours([{ day: 1, start: '09:00', end: '09:03' }]);
check('a sitting too short for an appointment is refused', tooShort.status === 422, tooShort.status);

const overlapping = await hours([
  { day: 4, start: '09:00', end: '13:00' },
  { day: 4, start: '12:00', end: '17:00' },
]);
check('overlapping sittings are refused', overlapping.status === 422, overlapping.status);
check(
  'the overlap is reported against the later row',
  'workingHours.1' in detailsOf(overlapping.body),
  detailsOf(overlapping.body),
);

// Order must not matter: the same clash written the other way round is still a clash.
const overlapReversed = await hours([
  { day: 4, start: '12:00', end: '17:00' },
  { day: 4, start: '09:00', end: '13:00' },
]);
check('an overlap is caught whichever order it is sent in', overlapReversed.status === 422, overlapReversed.status);

// Same clock times, different days, is not an overlap.
const differentDays = await hours([
  { day: 5, start: '09:00', end: '13:00' },
  { day: 6, start: '09:00', end: '13:00' },
]);
check('the same hours on different days are fine', differentDays.status === 200, differentDays.body);

const everyProblem = await hours([
  { day: 1, start: '17:00', end: '09:00' },
  { day: 2, start: '09:00', end: '13:00' },
  { day: 2, start: '10:00', end: '11:00' },
]);
check(
  'every bad row is reported at once, not just the first',
  Object.keys(detailsOf(everyProblem.body)).length === 2,
  detailsOf(everyProblem.body),
);

const badTime = await hours([{ day: 1, start: '9am', end: '5pm' }]);
check('a time that is not a time is refused', badTime.status === 422, badTime.status);

const badDay = await hours([{ day: 9, start: '09:00', end: '13:00' }]);
check('a day outside the week is refused', badDay.status === 422, badDay.status);

const notJson = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: anitaToken,
  form: { workingHours: 'not json at all' },
});
check('unreadable working hours are refused clearly', notJson.status === 422, notJson.status);

// Nothing bad reached the database: the last accepted grid is still what is stored.
const stored = profileOf((await call('/api/doctor/profile', { token: anitaToken })).body);
check(
  'a refused grid never replaced the saved one',
  stored.workingHours.length === 2 && stored.workingHours.every((w) => w.start === '09:00'),
  stored.workingHours,
);

/* -------------------------------------------------- 5.3 appointment list --- */

type Appt = {
  id: string;
  status: string;
  slotStart: string;
  amount: number;
  tokenNumber: number;
  payment: { mode: string; status: string };
  doctor: { id: string; name: string };
  patient: { id: string; name: string; age?: number };
};
type ApptPage = { items: Appt[]; total: number; page: number; pageSize: number; pages: number };
const pageOf = (body: unknown) => body as ApptPage;

const { DoctorModel, AppointmentModel: Appts, UserModel: Users } = await import(
  '../src/models/index.js'
);
const anita = await Users.findOne({ email: 'rao@medihelp.test' });
const anitaDoctor = await DoctorModel.findOne({ userId: anita!._id });

const all = await call('/api/doctor/appointments?when=all', { token: anitaToken });
check('a doctor lists their own appointments', all.status === 200, all.status);
check(
  'the list holds exactly their own',
  pageOf(all.body).total === (await Appts.countDocuments({ doctorId: anitaDoctor!._id })),
  pageOf(all.body).total,
);
check(
  'no other doctor appears in it',
  pageOf(all.body).items.every((row) => row.doctor.id === String(anitaDoctor!._id)),
);
check(
  'each row carries the patient and their age',
  pageOf(all.body).items.every((row) => row.patient.name.length > 0 && row.patient.age !== undefined),
  pageOf(all.body).items[0],
);
check(
  'each row carries the time, payment and status',
  pageOf(all.body).items.every(
    (row) => row.slotStart.length > 0 && row.payment.mode.length > 0 && row.status.length > 0,
  ),
);

// A second doctor's list must be a different set entirely.
const meeraList = await call('/api/doctor/appointments?when=all', { token: meeraToken });
const anitaIds = new Set(pageOf(all.body).items.map((row) => row.id));
check(
  'another doctor sees none of the same appointments',
  pageOf(meeraList.body).items.every((row) => !anitaIds.has(row.id)),
);

const startOfTodayUtc = new Date();
startOfTodayUtc.setUTCHours(0, 0, 0, 0);
const startOfTomorrowUtc = new Date(startOfTodayUtc);
startOfTomorrowUtc.setUTCDate(startOfTomorrowUtc.getUTCDate() + 1);

const today = await call('/api/doctor/appointments?when=today', { token: anitaToken });
check(
  'the today filter holds only today',
  pageOf(today.body).items.every(
    (row) => row.slotStart.slice(0, 10) === startOfTodayUtc.toISOString().slice(0, 10),
  ),
  pageOf(today.body).items.map((r) => r.slotStart),
);
check(
  'the today count matches the database',
  pageOf(today.body).total ===
    (await Appts.countDocuments({
      doctorId: anitaDoctor!._id,
      slotStart: { $gte: startOfTodayUtc, $lt: startOfTomorrowUtc },
    })),
  pageOf(today.body).total,
);

const past = await call('/api/doctor/appointments?when=past', { token: anitaToken });
check(
  'the past filter holds nothing from today onwards',
  pageOf(past.body).items.every((row) => new Date(row.slotStart) < startOfTodayUtc),
  pageOf(past.body).items.map((r) => r.slotStart),
);
check('past is newest first', pageOf(past.body).items.every(
  (row, i, rows) => i === 0 || rows[i - 1]!.slotStart >= row.slotStart,
));

const upcoming = await call('/api/doctor/appointments?when=upcoming', { token: anitaToken });
check(
  'the upcoming filter holds nothing before today',
  pageOf(upcoming.body).items.every((row) => new Date(row.slotStart) >= startOfTodayUtc),
  pageOf(upcoming.body).items.map((r) => r.slotStart),
);
// Soonest first, not newest: a list of what is still to come reads forwards.
check(
  'upcoming is soonest first',
  pageOf(upcoming.body).items.every((row, i, rows) => i === 0 || rows[i - 1]!.slotStart <= row.slotStart),
  pageOf(upcoming.body).items.map((r) => r.slotStart),
);
check(
  'upcoming includes today, so a late start does not hide the current patient',
  pageOf(today.body).items.every((row) => pageOf(upcoming.body).items.some((u) => u.id === row.id)),
);
check(
  'today, past and upcoming account for every appointment',
  pageOf(past.body).total + pageOf(upcoming.body).total === pageOf(all.body).total,
  { past: pageOf(past.body).total, upcoming: pageOf(upcoming.body).total, all: pageOf(all.body).total },
);

check('the default scope is upcoming', pageOf(
  (await call('/api/doctor/appointments', { token: anitaToken })).body,
).total === pageOf(upcoming.body).total);

check(
  'an unknown scope is refused',
  (await call('/api/doctor/appointments?when=someday', { token: anitaToken })).status === 422,
);
check(
  'a patient cannot read a doctor appointment list',
  (await call('/api/doctor/appointments', { token: patientToken })).status === 403,
);

const paged = await call('/api/doctor/appointments?when=all&pageSize=1', { token: anitaToken });
check('the list pages', pageOf(paged.body).items.length === 1 && pageOf(paged.body).pages === pageOf(all.body).total,
  { items: pageOf(paged.body).items.length, pages: pageOf(paged.body).pages });

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
