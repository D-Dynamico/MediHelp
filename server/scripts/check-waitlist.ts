/**
 * The auto-waitlist, end to end, over HTTP and a real socket, against a seeded
 * throwaway database.
 *
 * Run with: npm run check:waitlist --workspace server
 *
 * The phase's exit is three sentences and each has its assertions here:
 * cancelling a booked slot pushes an offer to the first waitlisted patient
 * live; letting the window lapse passes it to the next; claiming creates a real
 * appointment with a token number. The rest guard the ways a waitlist goes
 * wrong — a held slot being booked out from under the person it was offered
 * to, an offer claimed after it lapsed, and one patient claiming another's.
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
const { snapshotProvider } = await import('../src/modules/queue/queue.snapshot.js');
const { offerNext, sweepWaitlist } = await import('../src/modules/waitlist/waitlist.offers.js');
const { AppointmentModel, DoctorModel, UserModel, WaitlistModel, OFFER_WINDOW_MS } =
  await import('../src/models/index.js');
const { slotsOn } = await import('../src/modules/doctors/doctor.service.js');
const { dayKeyUtc, startOfDayUtc } = await import('../src/utils/dates.js');

await connectDb();
await mongoose.connection.syncIndexes();
const seeded = await seedDatabase();

const app = createApp();
const server = app.listen(0);
mountRealtime(server, snapshotProvider);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

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

async function tokenFor(email: string) {
  const response = await call('/api/auth/login', {
    method: 'POST',
    body: { email, password: seeded.credentials.password },
  });
  return (response.body as { accessToken?: string }).accessToken!;
}

/** Opens a signed-in socket. The user's own room is joined by the server. */
function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** Waits for the next `waitlist:update`, or gives up. */
function nextOffer(socket: Socket, ms = 3000): Promise<Record<string, never> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('waitlist:update', (payload: Record<string, never>) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/* ------------------------------------------------------------ fixtures --- */

const doctorUser = await UserModel.findOne({ email: seeded.credentials.doctor });
const doctor = (await DoctorModel.findOne({ userId: doctorUser!._id }))!;
const doctorId = String(doctor._id);

// Only the accounts whose ids the assertions read. The others are driven purely
// through their tokens.
const [sneha, fatima, joseph] = await Promise.all(
  ['sneha', 'fatima', 'joseph'].map((name) =>
    UserModel.findOne({ email: `${name}@medihelp.test` }),
  ),
);

// A future day this doctor works. Not tomorrow by assumption: the check must
// pass on whatever weekday it happens to run.
let day: Date | null = null;
for (let ahead = 1; ahead <= 13 && !day; ahead += 1) {
  const candidate = startOfDayUtc(new Date(Date.now() + ahead * 86_400_000));
  if ((await slotsOn(doctorId, candidate)).length > 0) day = candidate;
}
if (!day) throw new Error('The seeded doctor works no day in the next two weeks.');
const dayKey = dayKeyUtc(day);

const [rahulToken, snehaToken, tarunToken, fatimaToken, josephToken, doctorToken] =
  await Promise.all([
    tokenFor('rahul@medihelp.test'),
    tokenFor('sneha@medihelp.test'),
    tokenFor('tarun@medihelp.test'),
    tokenFor('fatima@medihelp.test'),
    tokenFor('joseph@medihelp.test'),
    tokenFor(seeded.credentials.doctor),
  ]);

/* ----------------------------------------------- only for a full day --- */

const early = await call('/api/waitlist', {
  method: 'POST',
  token: rahulToken,
  body: { doctorId, date: dayKey },
});
check('a day with free times cannot be waitlisted', early.status === 409, early.status);

// Fill the day. Joseph holds every slot; the others will wait for one.
await AppointmentModel.deleteMany({
  doctorId: doctor._id,
  slotStart: { $gte: day, $lt: new Date(day.getTime() + 86_400_000) },
});
const slots = await slotsOn(doctorId, day);
const filled = await Promise.all(
  slots.map((slot, index) =>
    AppointmentModel.create({
      patientId: joseph!._id,
      doctorId: doctor._id,
      slotStart: new Date(slot.start),
      slotEnd: new Date(slot.end),
      tokenNumber: index + 1,
      status: 'booked',
      amount: doctor.fees,
      payment: { mode: 'cash', status: 'pending_at_desk' },
      docSnapshot: { name: doctorUser!.name, speciality: doctor.speciality, fees: doctor.fees },
    }),
  ),
);
check(
  'the day is now full',
  (await slotsOn(doctorId, day)).every((slot) => !slot.available),
);

/* ------------------------------------------------------------- joining --- */

const rahulJoin = await call('/api/waitlist', {
  method: 'POST',
  token: rahulToken,
  body: { doctorId, date: dayKey },
});
check('a patient joins the waitlist for a full day', rahulJoin.status === 201, rahulJoin.status);
check('and is first in line', rahulJoin.body.entry?.ahead === 0, rahulJoin.body.entry?.ahead);

const snehaJoin = await call('/api/waitlist', {
  method: 'POST',
  token: snehaToken,
  body: { doctorId, date: dayKey },
});
check('the next one to join has one ahead', snehaJoin.body.entry?.ahead === 1, snehaJoin.body.entry);

const tarunJoin = await call('/api/waitlist', {
  method: 'POST',
  token: tarunToken,
  body: { doctorId, date: dayKey },
});
check('and the third has two', tarunJoin.body.entry?.ahead === 2, tarunJoin.body.entry);

const again = await call('/api/waitlist', {
  method: 'POST',
  token: rahulToken,
  body: { doctorId, date: dayKey },
});
check('joining the same day twice is refused', again.status === 409, again.status);

const hasOne = await call('/api/waitlist', {
  method: 'POST',
  token: josephToken,
  body: { doctorId, date: dayKey },
});
check(
  'a patient already booked with that doctor that day cannot wait for another slot',
  hasOne.status === 409,
  hasOne.status,
);

const yesterday = dayKeyUtc(new Date(Date.now() - 86_400_000));
check(
  'a day already gone is refused',
  (await call('/api/waitlist', { method: 'POST', token: fatimaToken, body: { doctorId, date: yesterday } }))
    .status === 409,
);
check(
  'a date that does not exist is refused',
  (await call('/api/waitlist', { method: 'POST', token: fatimaToken, body: { doctorId, date: '2026-02-31' } }))
    .status === 422,
);
check(
  'a doctor cannot join a waitlist',
  (await call('/api/waitlist', { method: 'POST', token: doctorToken, body: { doctorId, date: dayKey } }))
    .status === 403,
);

const snehaMine = await call('/api/waitlist', { token: snehaToken });
check(
  'a patient sees their own place in line',
  snehaMine.body.entries?.length === 1 && snehaMine.body.entries[0].ahead === 1,
  snehaMine.body.entries,
);

/* ------------------------------------------------- the offer, live --- */

const rahulSocket = await open(rahulToken);
const offerArrives = nextOffer(rahulSocket);

const freed = filled[2]!;
const cancelled = await call(`/api/appointments/${String(freed._id)}/cancel`, {
  method: 'PATCH',
  token: josephToken,
});
check('an appointment on the full day is cancelled', cancelled.status === 200, cancelled.status);

const pushed = await offerArrives;
check('the first person waiting is told live, without asking', pushed !== null);
check('the push is an offer', pushed?.state === 'offered', pushed?.state);
check(
  'for exactly the slot that was freed',
  (pushed?.offer as { slotStart?: string } | undefined)?.slotStart === freed.slotStart.toISOString(),
  pushed?.offer,
);
const window = pushed?.offer
  ? new Date((pushed.offer as { expiresAt: string }).expiresAt).getTime() - Date.now()
  : 0;
check(
  'with about ten minutes to decide',
  window > OFFER_WINDOW_MS - 60_000 && window <= OFFER_WINDOW_MS,
  window,
);

const rahulEntryId = String(rahulJoin.body.entry.id);

/* ------------------------------------------------ the slot is held --- */

const heldView = (await slotsOn(doctorId, day)).find(
  (slot) => slot.start === freed.slotStart.toISOString(),
);
check('the offered slot shows as taken to everyone else', heldView?.available === false, heldView);

const walkIn = await call('/api/appointments', {
  method: 'POST',
  token: fatimaToken,
  body: { doctorId, slotStart: freed.slotStart.toISOString(), mode: 'cash' },
});
check(
  'and nobody else can book it while the offer is open',
  walkIn.status === 409,
  walkIn.status,
);

check(
  "one patient cannot claim another's offer",
  (await call(`/api/waitlist/${rahulEntryId}/claim`, {
    method: 'POST',
    token: snehaToken,
    body: { mode: 'cash' },
  })).status === 404,
);
check(
  'a waiting entry with no offer cannot be claimed',
  (await call(`/api/waitlist/${String(snehaJoin.body.entry.id)}/claim`, {
    method: 'POST',
    token: snehaToken,
    body: { mode: 'cash' },
  })).status === 409,
);

/* ------------------------------------------ letting it go passes it on --- */

const snehaSocket = await open(snehaToken);
const toSneha = nextOffer(snehaSocket);
const letGo = await call(`/api/waitlist/${rahulEntryId}`, { method: 'DELETE', token: rahulToken });
check('the first person lets the offer go', letGo.status === 200, letGo.status);
check('and is off the list', letGo.body.entry?.state === 'withdrawn', letGo.body.entry?.state);

const snehaOffer = await toSneha;
check(
  'the slot goes straight to the next person, not after the window',
  snehaOffer?.state === 'offered',
  snehaOffer?.state,
);

/* ---------------------------------------- a lapsed window passes it on --- */

const tarunSocket = await open(tarunToken);
const toTarun = nextOffer(tarunSocket);
const snehaLapse = nextOffer(snehaSocket);

// The sweeper, run with a clock eleven minutes ahead rather than by waiting.
const swept = await sweepWaitlist(new Date(Date.now() + OFFER_WINDOW_MS + 60_000));
check('the sweep lapses the unclaimed offer', swept.expired >= 1, swept);

const lapsedNotice = await snehaLapse;
check('the person whose window closed is told', lapsedNotice?.state === 'expired', lapsedNotice?.state);

const tarunOffer = await toTarun;
check('and the next person is offered it live', tarunOffer?.state === 'offered', tarunOffer?.state);

// Sneha's own list keeps the lapsed offer for a while, so the screen can say
// what happened rather than letting the card vanish.
const snehaAfter = await call('/api/waitlist', { token: snehaToken });
check(
  'a lapsed offer stays on the patient screen as expired',
  snehaAfter.body.entries?.some((entry: { state: string }) => entry.state === 'expired'),
  snehaAfter.body.entries,
);

/* ------------------------------------------------------------ claiming --- */

const tarunEntryId = String(tarunJoin.body.entry.id);
const claimed = await call(`/api/waitlist/${tarunEntryId}/claim`, {
  method: 'POST',
  token: tarunToken,
  body: { mode: 'cash' },
});
check('claiming creates an appointment', claimed.status === 201, claimed.status);
check(
  'for the freed slot',
  claimed.body.appointment?.slotStart === freed.slotStart.toISOString(),
  claimed.body.appointment?.slotStart,
);
check(
  'carrying the token that slot has always had',
  claimed.body.appointment?.tokenNumber === freed.tokenNumber,
  claimed.body.appointment?.tokenNumber,
);
check(
  'at the fee on the doctor record',
  claimed.body.appointment?.amount === doctor.fees,
  claimed.body.appointment?.amount,
);
check('and the entry is marked claimed', claimed.body.entry?.state === 'claimed', claimed.body.entry?.state);

const twice = await call(`/api/waitlist/${tarunEntryId}/claim`, {
  method: 'POST',
  token: tarunToken,
  body: { mode: 'cash' },
});
check('an offer cannot be claimed twice', twice.status === 409, twice.status);

/* ----------------------------------- when the list runs out, it reopens --- */

const tarunAppointment = String(claimed.body.appointment.id);
await call(`/api/appointments/${tarunAppointment}/cancel`, { method: 'PATCH', token: tarunToken });
const reopened = (await slotsOn(doctorId, day)).find(
  (slot) => slot.start === freed.slotStart.toISOString(),
);
check(
  'with nobody left waiting, a cancelled slot is simply open again',
  reopened?.available === true,
  reopened,
);

/* --------------------------------------- a claim after the window closes --- */

// The sweeper has not run, and the host may have been asleep. The claim itself
// must still refuse, and move the slot on.
const fatimaJoin = await call('/api/waitlist', {
  method: 'POST',
  token: fatimaToken,
  body: { doctorId, date: dayKey },
});
// The reopened slot has to be taken again for the day to count as full.
await AppointmentModel.create({
  patientId: joseph!._id,
  doctorId: doctor._id,
  slotStart: freed.slotStart,
  slotEnd: freed.slotEnd,
  tokenNumber: freed.tokenNumber,
  status: 'booked',
  amount: doctor.fees,
  payment: { mode: 'cash', status: 'pending_at_desk' },
  docSnapshot: { name: doctorUser!.name, speciality: doctor.speciality, fees: doctor.fees },
});
const fatimaEntry =
  fatimaJoin.status === 201
    ? fatimaJoin.body.entry
    : (await call('/api/waitlist', { method: 'POST', token: fatimaToken, body: { doctorId, date: dayKey } }))
        .body.entry;
check('a patient joins once the day is full again', Boolean(fatimaEntry?.id), fatimaJoin.body);

const another = filled[4]!;
await call(`/api/appointments/${String(another._id)}/cancel`, { method: 'PATCH', token: josephToken });
await WaitlistModel.updateOne(
  { _id: fatimaEntry.id },
  { $set: { offerExpiresAt: new Date(Date.now() - 1000) } },
);
const late = await call(`/api/waitlist/${String(fatimaEntry.id)}/claim`, {
  method: 'POST',
  token: fatimaToken,
  body: { mode: 'cash' },
});
check('an offer past its window cannot be claimed', late.status === 409, late.status);
check(
  'even though the sweeper had not run yet',
  (await WaitlistModel.findById(fatimaEntry.id))?.state === 'expired',
  (await WaitlistModel.findById(fatimaEntry.id))?.state,
);
check(
  'and no appointment was made for it',
  !(await AppointmentModel.exists({ patientId: fatima!._id, slotStart: another.slotStart })),
);

/* --------------------------------------------------------- edge rules --- */

check(
  'a slot that has already begun is never offered',
  (await offerNext(doctor._id, new Date(Date.now() - 60_000), new Date(Date.now() + 60_000))) === null,
);

// Booking a time directly retires the same patient's wait for that day, so the
// entry is not offered a slot they no longer need.
await WaitlistModel.create({
  doctorId: doctor._id,
  patientId: sneha!._id,
  date: day,
  position: 99,
  state: 'waiting',
});
const openSlot = (await slotsOn(doctorId, day)).find((slot) => slot.available);
if (openSlot) {
  await call('/api/appointments', {
    method: 'POST',
    token: snehaToken,
    body: { doctorId, slotStart: openSlot.start, mode: 'cash' },
  });
  check(
    'booking a time directly takes the patient off that day waitlist',
    !(await WaitlistModel.exists({ patientId: sneha!._id, date: day, state: 'waiting' })),
  );
} else {
  check('there was a free slot to book directly', false, 'no open slot');
}

rahulSocket.close();
snehaSocket.close();
tarunSocket.close();

console.log(`\n${results.join('\n')}\n`);

closeRealtime();
server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
