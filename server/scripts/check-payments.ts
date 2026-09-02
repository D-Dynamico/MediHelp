/**
 * Drives the payment flow over HTTP against a seeded throwaway database.
 *
 * Run with: npm run check:payments --workspace server
 *
 * The assertions that matter most are the three the phase asks for: both modes
 * complete with no gateway keys set, a tampered amount in the request body
 * changes nothing because the fee comes from the doctor record, and replaying a
 * webhook does not credit twice.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'f'.repeat(48);
process.env.LOG_LEVEL = 'error';
// No RAZORPAY_KEY_ID or _SECRET: the provider stays the mock, which is the
// whole point — the flow has to work with no gateway account. The webhook
// secret is separate and is what the callback route verifies against.
const WEBHOOK_SECRET = 'whsec_for_the_checks';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { createApp } = await import('../src/app.js');
const { connectDb } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed.js');
const { mockSignatureFor } = await import('../src/providers/payment/mock.js');
const { razorpaySignature, razorpayWebhookSignature } = await import(
  '../src/providers/payment/razorpay.js'
);

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
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    raw?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: string | undefined;
  if (options.raw !== undefined) {
    headers['content-type'] = 'application/json';
    body = options.raw;
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

const rahulToken = await tokenFor('rahul@medihelp.test');
const snehaToken = await tokenFor('sneha@medihelp.test');
const anitaToken = await tokenFor('rao@medihelp.test');

interface Appointment {
  id: string;
  amount: number;
  tokenNumber: number;
  status: string;
  payment: { mode: string; status: string };
}
interface Order {
  appointmentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  keyId?: string;
  autoSettled: boolean;
  provider: string;
}
interface Slot {
  start: string;
  available: boolean;
}

const apptOf = (body: unknown) => (body as { appointment: Appointment }).appointment;
const orderOf = (body: unknown) => (body as { order: Order }).order;

const doctors = (await call('/api/doctors')).body as unknown as {
  doctors: { id: string; name: string; fees: number }[];
};
const anita = doctors.doctors.find((doctor) => doctor.name.includes('Rao'))!;

/**
 * A slot this doctor still has free.
 *
 * Scans forward rather than picking one day: the doctor does not sit every
 * weekday, and the seed has already booked some of the days they do. A check
 * that assumed a particular day would fail for a reason that has nothing to do
 * with payments.
 */
async function freeSlot(): Promise<string> {
  for (let ahead = 1; ahead <= 21; ahead += 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + ahead);

    const body = (
      await call(`/api/doctors/${anita.id}/slots?date=${day.toISOString().slice(0, 10)}`)
    ).body as unknown as { slots: Slot[] };

    const free = body.slots.find((slot) => slot.available);
    if (free) return free.start;
  }

  throw new Error('No free slot in the next three weeks — the seed or the hours changed.');
}

async function book(token: string, mode: 'cash' | 'razorpay', extra: object = {}) {
  return call('/api/appointments', {
    method: 'POST',
    token,
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode, ...extra },
  });
}

/* ------------------------------------------------------- 7.4 cash, end to end --- */

const cash = await book(rahulToken, 'cash');
check('a cash booking is taken', cash.status === 201, cash.body);
check(
  'and is owed at the desk from the start',
  apptOf(cash.body).payment.status === 'pending_at_desk',
  apptOf(cash.body).payment,
);

// Completing the consult is what settles cash: that is the moment someone
// confirms the patient turned up and paid.
const cashId = apptOf(cash.body).id;
await call(`/api/doctor/appointments/${cashId}/start`, { method: 'PATCH', token: anitaToken });
await call(`/api/doctor/appointments/${cashId}/complete`, { method: 'PATCH', token: anitaToken });

const settledCash = (await call('/api/appointments/mine?when=all&pageSize=100', {
  token: rahulToken,
})).body as unknown as { items: Appointment[] };
check(
  'completing the consult settles the cash payment',
  settledCash.items.find((a) => a.id === cashId)?.payment.status === 'paid',
  settledCash.items.find((a) => a.id === cashId)?.payment,
);

/* ------------------------------ 7.1-7.3 the gateway flow, with no keys set --- */

const online = await book(rahulToken, 'razorpay');
check('an online booking is taken', online.status === 201, online.body);
check(
  'and is pending until the money clears',
  apptOf(online.body).payment.status === 'pending',
  apptOf(online.body).payment,
);

const onlineId = apptOf(online.body).id;

check(
  'starting a payment needs a token',
  (await call('/api/payments/order', { method: 'POST', body: { appointmentId: onlineId } }))
    .status === 401,
);
check(
  'a doctor cannot start one',
  (await call('/api/payments/order', {
    method: 'POST',
    token: anitaToken,
    body: { appointmentId: onlineId },
  })).status === 403,
);
check(
  "a patient cannot start one for someone else's appointment",
  (await call('/api/payments/order', {
    method: 'POST',
    token: snehaToken,
    body: { appointmentId: onlineId },
  })).status === 403,
);
check(
  'a cash appointment has nothing to pay online',
  (await call('/api/payments/order', {
    method: 'POST',
    token: rahulToken,
    body: { appointmentId: cashId },
  })).status === 409,
);

const order = await call('/api/payments/order', {
  method: 'POST',
  token: rahulToken,
  body: { appointmentId: onlineId },
});
check('an order is created', order.status === 201, order.body);
check('with no keys set, the mock is the provider', orderOf(order.body).provider === 'mock');
check('the mock settles by itself, so a demo can finish', orderOf(order.body).autoSettled === true);
check('no key id is handed out when there is no gateway', orderOf(order.body).keyId === undefined);

// The exit criterion: the amount is the doctor's fee, in paise, whatever the
// client said.
check(
  'the order is for the fee from the doctor record, in paise',
  orderOf(order.body).amountMinor === anita.fees * 100,
  { got: orderOf(order.body).amountMinor, fee: anita.fees },
);

const orderId = orderOf(order.body).orderId;

/* ------------------------------------ only a real signature settles anything --- */

const forged = await call('/api/payments/verify', {
  method: 'POST',
  token: rahulToken,
  body: { appointmentId: onlineId, orderId, paymentId: 'pay_forged', signature: 'not-a-signature' },
});
check('a forged signature is refused', forged.status === 400, forged.body);

const afterForgery = (await call('/api/appointments/mine?when=all&pageSize=100', {
  token: rahulToken,
})).body as unknown as { items: Appointment[] };
check(
  'and the appointment is marked failed rather than paid',
  afterForgery.items.find((a) => a.id === onlineId)?.payment.status === 'failed',
  afterForgery.items.find((a) => a.id === onlineId)?.payment,
);

// A real signature, but for a different order, must not settle this one.
check(
  'a signature from another order does not settle this appointment',
  (await call('/api/payments/verify', {
    method: 'POST',
    token: rahulToken,
    body: {
      appointmentId: onlineId,
      orderId: 'order_somebody_elses',
      paymentId: 'pay_x',
      signature: mockSignatureFor('order_somebody_elses', 'pay_x'),
    },
  })).status === 400,
);

const good = await call('/api/payments/verify', {
  method: 'POST',
  token: rahulToken,
  body: {
    appointmentId: onlineId,
    orderId,
    paymentId: 'pay_real',
    signature: mockSignatureFor(orderId, 'pay_real'),
  },
});
check('a real signature settles the payment', good.status === 200, good.body);
check('the answer says paid', (good.body as unknown as { status: string }).status === 'paid');

const Payments = mongoose.connection.collection('payments');
const paidRows = await Payments.countDocuments({
  gatewayOrderId: orderId,
  status: 'paid',
});
check('exactly one payment row is marked paid', paidRows === 1, paidRows);
check(
  'the row records that the signature was checked',
  (await Payments.findOne({ gatewayOrderId: orderId }))?.signatureVerified === true,
);

// Replaying a successful verification must be a no-op, not a second credit.
const replayed = await call('/api/payments/verify', {
  method: 'POST',
  token: rahulToken,
  body: {
    appointmentId: onlineId,
    orderId,
    paymentId: 'pay_real',
    signature: mockSignatureFor(orderId, 'pay_real'),
  },
});
check('verifying twice is accepted and changes nothing', replayed.status === 200, replayed.body);
check(
  'still exactly one paid row',
  (await Payments.countDocuments({ gatewayOrderId: orderId, status: 'paid' })) === 1,
);

check(
  'an appointment already paid for cannot start another order',
  (await call('/api/payments/order', {
    method: 'POST',
    token: rahulToken,
    body: { appointmentId: onlineId },
  })).status === 409,
);

/* ---------------------------------------------------- 7.5 the webhook --- */

const onlineTwo = await book(snehaToken, 'razorpay');
const twoId = apptOf(onlineTwo.body).id;
const orderTwo = orderOf(
  (await call('/api/payments/order', {
    method: 'POST',
    token: snehaToken,
    body: { appointmentId: twoId },
  })).body,
).orderId;

const capture = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_hook', order_id: orderTwo } } },
});

check(
  'an unsigned webhook is refused',
  (await call('/api/payments/webhook', { method: 'POST', raw: capture })).status === 403,
);
check(
  'a wrongly signed webhook is refused',
  (await call('/api/payments/webhook', {
    method: 'POST',
    raw: capture,
    headers: { 'x-razorpay-signature': 'nonsense' },
  })).status === 403,
);

const signed = { 'x-razorpay-signature': razorpayWebhookSignature(capture, WEBHOOK_SECRET) };

const hook = await call('/api/payments/webhook', { method: 'POST', raw: capture, headers: signed });
check('a properly signed webhook is accepted', hook.status === 200, hook.body);
check('and it settled the payment', (hook.body as unknown as { handled: boolean }).handled === true);

const afterHook = (await call('/api/appointments/mine?when=all&pageSize=100', {
  token: snehaToken,
})).body as unknown as { items: Appointment[] };
check(
  'the appointment is paid',
  afterHook.items.find((a) => a.id === twoId)?.payment.status === 'paid',
  afterHook.items.find((a) => a.id === twoId)?.payment,
);

// The exit criterion: replaying the very same delivery must not credit twice.
const replayHook = await call('/api/payments/webhook', {
  method: 'POST',
  raw: capture,
  headers: signed,
});
check('replaying the webhook is accepted', replayHook.status === 200, replayHook.body);
check(
  'but it changes nothing the second time',
  (replayHook.body as unknown as { handled: boolean }).handled === false,
  replayHook.body,
);
check(
  'still exactly one paid row for that order',
  (await Payments.countDocuments({ gatewayOrderId: orderTwo, status: 'paid' })) === 1,
);

// An event we do not act on is still acknowledged, or the gateway retries it.
const other = JSON.stringify({ event: 'payment.failed', payload: {} });
const otherHook = await call('/api/payments/webhook', {
  method: 'POST',
  raw: other,
  headers: { 'x-razorpay-signature': razorpayWebhookSignature(other, WEBHOOK_SECRET) },
});
check('an event we ignore is still acknowledged', otherHook.status === 200, otherHook.body);

/* --------------------------------------------- refund on cancellation --- */

const cancelled = await call(`/api/appointments/${twoId}/cancel`, {
  method: 'PATCH',
  token: snehaToken,
});
check('a paid appointment can be cancelled', cancelled.status === 200, cancelled.body);
check(
  'and the money is marked as going back',
  apptOf(cancelled.body).payment.status === 'refunded',
  apptOf(cancelled.body).payment,
);
check(
  'the payment row records the refund too',
  (await Payments.findOne({ gatewayOrderId: orderTwo }))?.status === 'refunded',
);

/* --------------------------------- the signature functions, pinned --- */

// Pinned to fixed values so a change to either payload format fails loudly.
// The Razorpay provider has never run against a real account; this is what
// stands in for that until someone sets real keys.
check(
  'the checkout signature is HMAC-SHA256 over "order|payment"',
  razorpaySignature('order_test', 'pay_test', 'secret_key') ===
    'd956af31b3a05663ee03a5cdc0e52f4f2e9f791911ab8a287844cad2f3bc4030',
  razorpaySignature('order_test', 'pay_test', 'secret_key'),
);
check(
  'the webhook signature is HMAC-SHA256 over the raw body',
  razorpayWebhookSignature('{"a":1}', 'whsec_test') ===
    '51426af50a41dd7ff2cd3f116594734766d4018d15d6fb07169aee5d2959adf5',
  razorpayWebhookSignature('{"a":1}', 'whsec_test'),
);
check(
  'the two use different secrets, so one cannot stand in for the other',
  createHmac('sha256', 'a').update('x').digest('hex') !==
    createHmac('sha256', 'b').update('x').digest('hex'),
);

/* ------------------------ money that arrives after a cancellation --- */

// The race the review found: the patient opens checkout, the appointment is
// cancelled while the payment is still `pending` — so cancelling saw nothing to
// refund — and the capture then lands. It used to flip the cancelled
// appointment to `paid` and keep the money.
const late = await book(rahulToken, 'razorpay');
const lateId = apptOf(late.body).id;
const lateOrder = orderOf(
  (await call('/api/payments/order', { method: 'POST', token: rahulToken, body: { appointmentId: lateId } })).body,
).orderId;

const lateCancel = await call(`/api/appointments/${lateId}/cancel`, {
  method: 'PATCH',
  token: rahulToken,
});
check('an unpaid online appointment can still be cancelled', lateCancel.status === 200, lateCancel.body);
check(
  'cancelling before payment leaves nothing to refund',
  apptOf(lateCancel.body).payment.status === 'pending',
  apptOf(lateCancel.body).payment,
);

const lateVerify = await call('/api/payments/verify', {
  method: 'POST',
  token: rahulToken,
  body: {
    appointmentId: lateId,
    orderId: lateOrder,
    paymentId: 'pay_late',
    signature: mockSignatureFor(lateOrder, 'pay_late'),
  },
});
check('a capture that lands after the cancellation is accepted', lateVerify.status === 200, lateVerify.body);
check(
  'and is refunded on the spot rather than kept',
  (lateVerify.body as unknown as { status: string }).status === 'refunded',
  lateVerify.body,
);

const lateRow = await Payments.findOne({ gatewayOrderId: lateOrder });
check('the payment row records the money as refunded', lateRow?.status === 'refunded', lateRow?.status);
check('and carries the gateway refund id', Boolean(lateRow?.gatewayRefundId), lateRow?.gatewayRefundId);

const lateAppt = (await call('/api/appointments/mine?when=all&pageSize=100', {
  token: rahulToken,
})).body as unknown as { items: Appointment[] };
const lateFound = lateAppt.items.find((appointment) => appointment.id === lateId);
check('the appointment stays cancelled', lateFound?.status === 'cancelled', lateFound?.status);
check('and does not read as paid', lateFound?.payment.status === 'refunded', lateFound?.payment);

// The mock's own confirm endpoint settles on the button press, so there is no
// money in flight to hand back — it refuses instead.
const mockLate = await book(snehaToken, 'razorpay');
const mockLateId = apptOf(mockLate.body).id;
await call('/api/payments/order', { method: 'POST', token: snehaToken, body: { appointmentId: mockLateId } });
await call(`/api/appointments/${mockLateId}/cancel`, { method: 'PATCH', token: snehaToken });
const mockConfirm = await call('/api/payments/confirm-mock', {
  method: 'POST',
  token: snehaToken,
  body: { appointmentId: mockLateId },
});
check('the mock refuses to settle a cancelled appointment', mockConfirm.status === 409, mockConfirm.status);

/* ------------------- a webhook for an order that was superseded --- */

// A patient who abandons a checkout and starts a second one overwrites the
// appointment's current order id. If the first order captures, matching on the
// appointment finds nothing; the money is taken and the appointment left unpaid.
const superseded = await book(rahulToken, 'razorpay');
const supersededId = apptOf(superseded.body).id;
const firstOrder = orderOf(
  (await call('/api/payments/order', { method: 'POST', token: rahulToken, body: { appointmentId: supersededId } })).body,
).orderId;
const secondOrder = orderOf(
  (await call('/api/payments/order', { method: 'POST', token: rahulToken, body: { appointmentId: supersededId } })).body,
).orderId;
check('starting checkout twice makes two orders', firstOrder !== secondOrder, { firstOrder, secondOrder });

const firstCapture = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_first', order_id: firstOrder } } },
});
const firstHook = await call('/api/payments/webhook', {
  method: 'POST',
  raw: firstCapture,
  headers: { 'x-razorpay-signature': razorpayWebhookSignature(firstCapture, WEBHOOK_SECRET) },
});
check('a capture for the abandoned first order is still matched', firstHook.status === 200, firstHook.body);
check('and settles the appointment', (firstHook.body as unknown as { handled: boolean }).handled, firstHook.body);

const supersededAppt = ((await call('/api/appointments/mine?when=all&pageSize=100', {
  token: rahulToken,
})).body as unknown as { items: Appointment[] }).items.find((a) => a.id === supersededId);
check('the appointment reads as paid', supersededAppt?.payment.status === 'paid', supersededAppt?.payment);


console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
