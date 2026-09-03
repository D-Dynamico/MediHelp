/**
 * The live queue, over HTTP and over a real socket, against a seeded throwaway
 * database.
 *
 * Run with: npm run check:queue --workspace server
 *
 * The assertions that matter most are the three the phase turns on: calling the
 * next patient reaches a listening socket without anyone asking for it; the
 * payload that reaches it carries no patient names, because a waiting-room wall
 * and every other patient are in the same room; and a board link for one doctor
 * opens exactly one doctor's queue.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { io as connect, type Socket } from 'socket.io-client';
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
const { mountRealtime, closeRealtime } = await import('../src/realtime/io.js');
const { AppointmentModel, DoctorModel, QueueSessionModel, UserModel } = await import(
  '../src/models/index.js'
);
const { startOfDayUtc, dayKeyUtc } = await import('../src/utils/dates.js');

await connectDb();
await mongoose.connection.syncIndexes();
const seeded = await seedDatabase();

const app = createApp();
const server = app.listen(0);
mountRealtime(server);
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as any };
}

async function tokenFor(email: string, password = seeded.credentials.password) {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

/* ------------------------------------------------------------ fixtures --- */

// Appointments are written directly rather than booked, so the check does not
// depend on the seeded doctor happening to work on the day it runs. Tokens are
// set explicitly for the same reason: what is under test here is the queue, not
// the allocator.
const doctorUser = await UserModel.findOne({ email: seeded.credentials.doctor });
const doctor = await DoctorModel.findOne({ userId: doctorUser!._id });
const otherDoctor = await DoctorModel.findOne({ _id: { $ne: doctor!._id } });
const patients = await UserModel.find({ role: 'patient' }).limit(3);

const today = startOfDayUtc();
const todayKey = dayKeyUtc();

// The seed gives this doctor a booking today. Clearing the day first means the
// counts below are about the fixtures and nothing else.
await AppointmentModel.deleteMany({
  doctorId: doctor!._id,
  slotStart: { $gte: today, $lt: new Date(today.getTime() + 86_400_000) },
});

async function makeAppointment(index: number, token: number, hour: number) {
  const slotStart = new Date(today.getTime() + hour * 3_600_000);
  return AppointmentModel.create({
    patientId: patients[index]!._id,
    doctorId: doctor!._id,
    slotStart,
    slotEnd: new Date(slotStart.getTime() + 20 * 60_000),
    tokenNumber: token,
    status: 'booked',
    amount: 500,
    payment: { mode: 'cash', status: 'pending_at_desk' },
    docSnapshot: { name: doctorUser!.name, speciality: doctor!.speciality, fees: 500 },
  });
}

const first = await makeAppointment(0, 3, 9);
const second = await makeAppointment(1, 5, 10);
const third = await makeAppointment(2, 8, 11);

const doctorToken = await tokenFor(seeded.credentials.doctor);
const patientToken = await tokenFor(seeded.credentials.patient);

/* --------------------------------------------------- the doctor's list --- */

const queue = await call('/api/doctor/queue', { token: doctorToken });
check('a doctor reads their own queue', queue.status === 200, queue.status);
check(
  'and it holds the three appointments made for today',
  queue.body.entries.length === 3,
  queue.body.entries.length,
);
check(
  'in token order, not the order they were written',
  JSON.stringify(queue.body.entries.map((e: { tokenNumber: number }) => e.tokenNumber)) ===
    JSON.stringify([3, 5, 8]),
  queue.body.entries.map((e: { tokenNumber: number }) => e.tokenNumber),
);
check('with the names the doctor needs', typeof queue.body.entries[0].patientName === 'string');
check(
  'nobody is waiting before anyone checks in',
  queue.body.snapshot.waiting.length === 0,
  queue.body.snapshot.waiting,
);
check(
  'and the day has not started',
  queue.body.snapshot.currentToken === 0,
  queue.body.snapshot.currentToken,
);

const asPatient = await call('/api/doctor/queue', { token: patientToken });
check('a patient cannot read a doctor queue', asPatient.status === 403, asPatient.status);
check('nor can a stranger', (await call('/api/doctor/queue')).status === 401);

/* ------------------------------------------------------------ check-in --- */

const early = await call('/api/doctor/queue/call-next', { method: 'POST', token: doctorToken });
check('calling next with nobody checked in is refused', early.status === 409, early.status);

const checkedIn = await call(`/api/doctor/queue/${String(second._id)}/check-in`, {
  method: 'POST',
  token: doctorToken,
});
check('the desk checks a patient in', checkedIn.status === 200, checkedIn.status);
check(
  'and that token joins the waiting line',
  JSON.stringify(checkedIn.body.snapshot.waiting) === JSON.stringify([5]),
  checkedIn.body.snapshot.waiting,
);

const twice = await call(`/api/doctor/queue/${String(second._id)}/check-in`, {
  method: 'POST',
  token: doctorToken,
});
// Refused rather than ignored: a second check-in would move `checkedInAt` and
// reset the waiting time the doctor reads to decide who has waited longest.
check('checking the same patient in twice is refused', twice.status === 409, twice.status);

// The one that matters most for ownership: an appointment belonging to another
// doctor must be invisible, not merely forbidden.
const strangerAppointment = await AppointmentModel.create({
  patientId: patients[0]!._id,
  doctorId: otherDoctor!._id,
  slotStart: new Date(today.getTime() + 14 * 3_600_000),
  slotEnd: new Date(today.getTime() + 14 * 3_600_000 + 20 * 60_000),
  tokenNumber: 2,
  status: 'booked',
  amount: 500,
  payment: { mode: 'cash', status: 'pending_at_desk' },
  docSnapshot: { name: 'Someone else', speciality: otherDoctor!.speciality, fees: 500 },
});
const notMine = await call(`/api/doctor/queue/${String(strangerAppointment._id)}/check-in`, {
  method: 'POST',
  token: doctorToken,
});
check(
  "another doctor's appointment answers 404, not 403",
  notMine.status === 404,
  notMine.status,
);

/* ------------------------------------------------------- sockets --------- */

/** Opens a socket and resolves once it is connected, or rejects on refusal. */
function open(auth: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

/** Waits for one `queue:update`, or gives up. */
function nextUpdate(socket: Socket, ms = 3000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('queue:update', (payload: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

let refused = false;
try {
  await open({});
} catch {
  refused = true;
}
check('a socket with no credentials is refused', refused);

let badToken = false;
try {
  await open({ token: 'not-a-jwt' });
} catch {
  badToken = true;
}
check('and so is one with a token we did not sign', badToken);

// The patient is the one the phase's exit criterion is about: they get the
// update without asking for it, on a connection they opened before it happened.
const patientSocket = await open({ token: patientToken });
patientSocket.emit('queue:join', { doctorId: String(doctor!._id), date: todayKey });
// A join is fire-and-forget, so give the server a moment to put us in the room
// before the action that broadcasts to it.
await new Promise((resolve) => setTimeout(resolve, 200));

const updatePromise = nextUpdate(patientSocket);
const called = await call('/api/doctor/queue/call-next', { method: 'POST', token: doctorToken });
check('the doctor calls the next patient', called.status === 200, called.status);
check(
  'the lowest waiting token is the one called',
  called.body.snapshot.currentToken === 5,
  called.body.snapshot.currentToken,
);

const update = await updatePromise;
check('a listening patient is told, without asking', update !== null);
check(
  'and the update names the token being seen',
  update?.currentToken === 5,
  update?.currentToken,
);

// The decision the whole payload was shaped around. This room holds every
// patient of this doctor and an unauthenticated screen on a wall.
const payloadText = JSON.stringify(update ?? {});
check(
  'no patient name travels over the room',
  patients.every((patient) => !payloadText.includes(patient.name)),
  payloadText,
);

const busy = await call('/api/doctor/queue/call-next', { method: 'POST', token: doctorToken });
check(
  'calling next while someone is in the room is refused',
  busy.status === 409,
  busy.status,
);

/* --------------------------------------------------- finishing the day --- */

const done = await call(`/api/doctor/queue/${String(second._id)}/complete`, {
  method: 'POST',
  token: doctorToken,
});
check('the consult is completed', done.status === 200, done.status);
check(
  'a cash payment settles when the consult does',
  done.body.appointment.payment.status === 'paid',
  done.body.appointment.payment.status,
);
check(
  'the board keeps showing the last token called',
  done.body.queue.snapshot.currentToken === 5,
  done.body.queue.snapshot.currentToken,
);

const session = await QueueSessionModel.findOne({ doctorId: doctor!._id, date: today });
check('the day counts one patient through', session?.servedCount === 1, session?.servedCount);

const noShow = await call(`/api/doctor/queue/${String(first._id)}/no-show`, {
  method: 'POST',
  token: doctorToken,
});
check('a patient who never arrived is marked a no-show', noShow.status === 200, noShow.status);
check(
  'and a no-show is not a cancellation',
  noShow.body.appointment.status === 'no_show',
  noShow.body.appointment.status,
);
check(
  'no money is handed back on a no-show',
  noShow.body.appointment.payment.status === 'pending_at_desk',
  noShow.body.appointment.payment.status,
);

/* ---------------------------------------------------------- board links --- */

const link = await call('/api/doctor/queue/board-link', { token: doctorToken });
check('a doctor can mint a board link', link.status === 200, link.status);
const boardToken = new URL(`http://x${String(link.body.link.path)}`).searchParams.get('t')!;
check('the link names the doctor it is for', String(link.body.link.path).includes(String(doctor!._id)));

const boardRead = await call(`/api/board/${String(doctor!._id)}?t=${boardToken}`);
check('the board reads with no login at all', boardRead.status === 200, boardRead.status);
check(
  'and sees the token being served',
  boardRead.body.snapshot.currentToken === 5,
  boardRead.body.snapshot.currentToken,
);
check(
  'the board payload carries no names either',
  patients.every((patient) => !JSON.stringify(boardRead.body).includes(patient.name)),
);

check('a board with no link is refused', (await call(`/api/board/${String(doctor!._id)}`)).status === 422);
const wrongDoctor = await call(`/api/board/${String(otherDoctor!._id)}?t=${boardToken}`);
check(
  "one doctor's link does not open another's board",
  wrongDoctor.status === 401,
  wrongDoctor.status,
);

// The reason board tokens carry `typ`. Same secret, same issuer: without that
// check an access token would pass here and a board token would pass as a login.
const accessAsBoard = await call(`/api/board/${String(doctor!._id)}?t=${doctorToken}`);
check(
  'an access token is not a board link',
  accessAsBoard.status === 401,
  accessAsBoard.status,
);

const boardSocketBlocked = await open({ board: boardToken });
boardSocketBlocked.emit('queue:join', { doctorId: String(otherDoctor!._id), date: todayKey });
await new Promise((resolve) => setTimeout(resolve, 200));
const strayUpdate = nextUpdate(boardSocketBlocked, 800);
await call(`/api/doctor/queue/${String(third._id)}/check-in`, {
  method: 'POST',
  token: doctorToken,
});
check(
  "a board link cannot listen to another doctor's room",
  (await strayUpdate) === null,
);

patientSocket.close();
boardSocketBlocked.close();

console.log(`\n${results.join('\n')}\n`);

closeRealtime();
server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
