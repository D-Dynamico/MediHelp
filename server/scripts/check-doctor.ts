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

/* ------------------------------------------------------------ 5.4 actions --- */

async function act(id: string, action: 'start' | 'complete' | 'cancel', token: string) {
  const response = await fetch(`${base}/api/doctor/appointments/${id}/${action}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
}
const apptOf = (body: unknown) => (body as { appointment: Appt }).appointment;

// The assertion this whole module exists for: a doctor holding a valid token,
// with the right role, must not be able to touch another doctor's appointment
// by putting its id in the URL. Only the ownership check stops this.
const meeraAppt = pageOf(meeraList.body).items[0]!;
const trespass = await act(meeraAppt.id, 'complete', anitaToken);
check("a doctor cannot complete another doctor's appointment", trespass.status === 403, trespass.body);
check(
  "a doctor cannot cancel another doctor's appointment",
  (await act(meeraAppt.id, 'cancel', anitaToken)).status === 403,
);
check(
  "a doctor cannot start another doctor's consult",
  (await act(meeraAppt.id, 'start', anitaToken)).status === 403,
);
check(
  'the trespass changed nothing',
  (await Appts.findById(meeraAppt.id))?.status === meeraAppt.status,
);
check(
  'a patient cannot use the doctor actions at all',
  (await act(meeraAppt.id, 'complete', patientToken)).status === 403,
);

// One booking of Anita's, taken from start to finish. Its payment is forced to
// unsettled cash here rather than hunted for in the seed: which of the seeded
// rows happens to be cash is an accident of the seed's ordering, and a check
// that depends on that breaks the next time the sample data is edited.
const own = await Appts.findOne({ doctorId: anitaDoctor!._id, status: 'booked' });
const ownId = String(own!._id);
await Appts.updateOne(
  { _id: ownId },
  { $set: { 'payment.mode': 'cash', 'payment.status': 'pending_at_desk' } },
);

const started = await act(ownId, 'start', anitaToken);
check('a doctor starts their own consult', started.status === 200, started.body);
check('the consult is in progress', apptOf(started.body).status === 'in_progress', apptOf(started.body).status);
const startedAt = (await Appts.findById(ownId))?.consultStartedAt;
check('the start time was stamped', startedAt instanceof Date);

// Starting again must not move the clock — that would shorten the consult being
// measured, and a doctor tapping twice has done nothing wrong.
const restarted = await act(ownId, 'start', anitaToken);
check('starting twice is not an error', restarted.status === 200, restarted.status);
check(
  'starting twice does not move the start time',
  (await Appts.findById(ownId))?.consultStartedAt?.getTime() === startedAt?.getTime(),
);

// Backdate the start so the completion has a plausible length to learn from.
await Appts.updateOne({ _id: ownId }, { $set: { consultStartedAt: new Date(Date.now() - 20 * 60_000) } });
const medianBefore = (await DoctorModel.findById(anitaDoctor!._id))!.medianConsultMins;

const finished = await act(ownId, 'complete', anitaToken);
check('a doctor completes their own consult', finished.status === 200, finished.body);
check('it is marked completed', apptOf(finished.body).status === 'completed');
check(
  'a cash payment is settled on completion',
  apptOf(finished.body).payment.status === 'paid',
  apptOf(finished.body).payment,
);
check('the end time was stamped', (await Appts.findById(ownId))?.consultEndedAt instanceof Date);

const medianAfter = (await DoctorModel.findById(anitaDoctor!._id))!.medianConsultMins;
check(
  'completing a timed consult moves the doctor\'s typical length toward it',
  medianAfter > medianBefore && medianAfter < 20,
  { before: medianBefore, after: medianAfter },
);

check('completing twice is refused', (await act(ownId, 'complete', anitaToken)).status === 409);
check('a completed consult cannot be cancelled', (await act(ownId, 'cancel', anitaToken)).status === 409);
check('a completed consult cannot be restarted', (await act(ownId, 'start', anitaToken)).status === 409);

// An implausible length is a clock problem, not a measurement.
const wild = await Appts.findOne({ doctorId: anitaDoctor!._id, status: 'booked' });
if (wild) {
  await Appts.updateOne(
    { _id: wild._id },
    { $set: { status: 'in_progress', consultStartedAt: new Date(Date.now() - 30 * 60 * 60_000) } },
  );
  const medianWas = (await DoctorModel.findById(anitaDoctor!._id))!.medianConsultMins;
  await act(String(wild._id), 'complete', anitaToken);
  check(
    'a thirty-hour consult is ignored rather than learned from',
    (await DoctorModel.findById(anitaDoctor!._id))!.medianConsultMins === medianWas,
  );
}

const toCancel = await Appts.findOne({ doctorId: anitaDoctor!._id, status: 'booked' });
if (toCancel) {
  const cancelled2 = await act(String(toCancel._id), 'cancel', anitaToken);
  check('a doctor cancels their own appointment', cancelled2.status === 200, cancelled2.body);
  check('it is recorded as cancelled by the doctor', (await Appts.findById(toCancel._id))?.cancelledBy === 'doctor');
}

check(
  'acting on an appointment that does not exist is a 404',
  (await act('0'.repeat(24), 'complete', anitaToken)).status === 404,
);
check(
  'a malformed id is refused before any lookup',
  (await act('nonsense', 'complete', anitaToken)).status === 422,
);

// Every action wrote an audit row naming who did it.
const { AuditLogModel } = await import('../src/models/index.js');
check(
  'the actions are recorded in the audit log',
  (await AuditLogModel.countDocuments({ actorId: anita!._id, action: /^appointment\./ })) >= 3,
  await AuditLogModel.countDocuments({ actorId: anita!._id }),
);

/* ----------------------------------------------------------- 5.5 earnings --- */

type Earnings = { total: number; thisMonth: number; appointments: number; patients: number };
const earningsOf = (body: unknown) => body as Earnings;

check(
  'a patient cannot read a doctor\'s earnings',
  (await call('/api/doctor/earnings', { token: patientToken })).status === 403,
);
check('earnings need a token', (await call('/api/doctor/earnings')).status === 401);

const paidFilter = {
  doctorId: anitaDoctor!._id,
  status: 'completed' as const,
  'payment.status': 'paid' as const,
};

const money = await call('/api/doctor/earnings', { token: anitaToken });
check('a doctor reads their own earnings', money.status === 200, money.status);

const expected = await Appts.aggregate<{ total: number; n: number }>([
  { $match: paidFilter },
  { $group: { _id: null, total: { $sum: '$amount' }, n: { $sum: 1 } } },
]);
check(
  'the total is the sum of completed, paid consults',
  earningsOf(money.body).total === (expected[0]?.total ?? 0),
  { got: earningsOf(money.body).total, expected: expected[0]?.total },
);
check(
  'the consult count matches',
  earningsOf(money.body).appointments === (expected[0]?.n ?? 0),
  earningsOf(money.body).appointments,
);
check('the doctor has actually earned something', earningsOf(money.body).total > 0, earningsOf(money.body));

// Distinct people, not consults. Someone seen monthly all year is one patient.
const distinct = await Appts.aggregate<{ _id: null; n: number }>([
  { $match: paidFilter },
  { $group: { _id: '$patientId' } },
  { $count: 'n' },
]);
check(
  'the patient count is distinct people, not consults',
  earningsOf(money.body).patients === (distinct[0]?.n ?? 0),
  { got: earningsOf(money.body).patients, expected: distinct[0]?.n },
);
check(
  'there are no more patients than consults',
  earningsOf(money.body).patients <= earningsOf(money.body).appointments,
  earningsOf(money.body),
);

const startOfMonth = new Date(startOfTodayUtc);
startOfMonth.setUTCDate(1);
const monthly = await Appts.aggregate<{ total: number }>([
  { $match: { ...paidFilter, slotStart: { $gte: startOfMonth } } },
  { $group: { _id: null, total: { $sum: '$amount' } } },
]);
check(
  "this month's figure matches the database",
  earningsOf(money.body).thisMonth === (monthly[0]?.total ?? 0),
  { got: earningsOf(money.body).thisMonth, expected: monthly[0]?.total },
);
check(
  'this month is never more than the total',
  earningsOf(money.body).thisMonth <= earningsOf(money.body).total,
  earningsOf(money.body),
);

// The exit criterion for the phase: completing one appointment raises the tile
// by exactly its fee, and by nothing else.
//
// The appointment is created here rather than borrowed from the seed. By this
// point the earlier blocks have completed or cancelled everything of Anita's
// that was still open, so a check that looked for a leftover booking would
// quietly skip itself — which is worse than failing, because it looks like a
// pass.
const anitaFee = 777;
async function bookForAnita(overrides: Record<string, unknown> = {}) {
  const slot = new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60_000);
  slot.setUTCMinutes(0, 0, 0);
  return Appts.create({
    patientId: (await Users.findOne({ email: 'sneha@medihelp.test' }))!._id,
    doctorId: anitaDoctor!._id,
    slotStart: slot,
    slotEnd: new Date(slot.getTime() + 30 * 60_000),
    tokenNumber: 1,
    status: 'booked',
    amount: anitaFee,
    payment: { mode: 'cash', status: 'pending_at_desk' },
    docSnapshot: { name: 'Dr. Anita Rao', speciality: 'General physician', fees: anitaFee },
    ...overrides,
  });
}

const fresh = await bookForAnita();
const before = earningsOf((await call('/api/doctor/earnings', { token: anitaToken })).body);
const completedIt = await act(String(fresh._id), 'complete', anitaToken);
check('the exit-criterion consult completed', completedIt.status === 200, completedIt.body);

const after = earningsOf((await call('/api/doctor/earnings', { token: anitaToken })).body);
check(
  'completing an appointment raises the total by exactly its fee',
  after.total === before.total + anitaFee,
  { before: before.total, after: after.total, fee: anitaFee },
);
check('the consult count went up by exactly one', after.appointments === before.appointments + 1,
  { before: before.appointments, after: after.appointments });
check(
  "this month's figure moved too, since the slot is in this month or the next",
  after.thisMonth >= before.thisMonth,
  { before: before.thisMonth, after: after.thisMonth },
);

// A cancelled consult is not earnings, however it was paid for.
const paidThenCancelled = await bookForAnita({ status: 'cancelled', payment: { mode: 'razorpay', status: 'paid' } });
const withCancelled = earningsOf((await call('/api/doctor/earnings', { token: anitaToken })).body);
check(
  'a cancelled consult is not earnings even when it was paid for',
  withCancelled.total === after.total,
  { before: after.total, after: withCancelled.total, ignored: anitaFee },
);
await Appts.deleteOne({ _id: paidThenCancelled._id });

// Nor is a completed consult that was never paid for.
const completedUnpaid = await bookForAnita({ status: 'completed', payment: { mode: 'cash', status: 'pending_at_desk' } });
check(
  'a completed consult that was never paid for is not earnings',
  earningsOf((await call('/api/doctor/earnings', { token: anitaToken })).body).total === after.total,
);
await Appts.deleteOne({ _id: completedUnpaid._id });

// Another doctor's earnings are their own.
const meeraMoney = earningsOf((await call('/api/doctor/earnings', { token: meeraToken })).body);
check(
  "one doctor's earnings are not another's",
  meeraMoney.total !== earningsOf((await call('/api/doctor/earnings', { token: anitaToken })).body).total,
  { meera: meeraMoney.total },
);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
