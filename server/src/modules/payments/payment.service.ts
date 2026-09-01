import { Types } from 'mongoose';
import type { PaymentStatus } from '@shared/types.js';
import { AppointmentModel, PaymentModel, type AppointmentDocument } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { logger } from '../../config/logger.js';
import { getSettings } from '../../config/env.js';
import { payments } from '../../providers/payment/index.js';
import { razorpayWebhookSignature } from '../../providers/payment/razorpay.js';
import { safeEqual } from '../../providers/payment/mock.js';

/**
 * Taking money for an appointment.
 *
 * Two rules run through all of it. The amount is always read from the
 * appointment, which took it from the doctor record at booking time — no path in
 * here reads an amount from a request. And nothing is marked paid on a client's
 * say-so: the only thing that flips a payment to `paid` is a signature this
 * server recomputed with a secret the client does not have.
 */

/** What the client needs to open a checkout, or to confirm against the mock. */
export interface OrderResponse {
  appointmentId: string;
  orderId: string;
  amountMinor: number;
  currency: 'INR';
  keyId?: string | undefined;
  /** True when the provider settles by itself — the mock, with no keys set. */
  autoSettled: boolean;
  provider: 'mock' | 'razorpay';
}

/** Loads an appointment and refuses if it is not this patient's. */
async function ownAppointment(id: string, patientId: string): Promise<AppointmentDocument> {
  const appointment = await AppointmentModel.findById(id);
  if (!appointment) throw ApiError.notFound('No appointment with that id.');

  // Ownership, not just a role check. Otherwise any signed-in patient could pay
  // against — or read the order for — somebody else's appointment.
  if (String(appointment.patientId) !== patientId) throw ApiError.forbidden();

  return appointment;
}

/**
 * Starts a payment for an appointment.
 *
 * Idempotent by intent rather than by accident: asking twice creates a second
 * order, which is fine and is what a patient who abandoned a checkout and came
 * back needs. What it will not do is create one for an appointment already paid.
 */
export async function createOrder(appointmentId: string, patientId: string): Promise<OrderResponse> {
  const appointment = await ownAppointment(appointmentId, patientId);

  if (appointment.status === 'cancelled') {
    throw ApiError.conflict('That appointment was cancelled.');
  }
  if (appointment.payment?.status === 'paid') {
    throw ApiError.conflict('That appointment is already paid for.');
  }
  if (appointment.payment?.mode !== 'razorpay') {
    throw ApiError.conflict('That appointment is being paid in cash at the clinic.');
  }

  const provider = payments();
  const order = await provider.createOrder({
    // From the appointment, frozen at booking. Never from the request.
    amount: appointment.amount,
    receipt: String(appointment._id),
  });

  // A row per attempt. The appointment carries the current state for display;
  // this collection is the audit trail, including the attempts that failed.
  await PaymentModel.create({
    appointmentId: appointment._id,
    mode: 'razorpay',
    amount: appointment.amount,
    status: 'pending',
    gatewayOrderId: order.orderId,
    signatureVerified: false,
  });

  appointment.set('payment.orderId', order.orderId);
  appointment.set('payment.status', 'pending');
  await appointment.save();

  return {
    appointmentId: String(appointment._id),
    orderId: order.orderId,
    amountMinor: order.amountMinor,
    currency: order.currency,
    keyId: order.keyId,
    autoSettled: order.autoSettled,
    provider: provider.name,
  };
}

/**
 * Confirms a payment the client says has gone through.
 *
 * The signature is the whole of it. Everything else in the request — the amount
 * it thinks it paid, the status it thinks it has — is ignored, because a client
 * can say anything. Only the HMAC, recomputed here with a secret the client does
 * not hold, decides.
 */
export async function verifyPayment(
  input: { appointmentId: string; orderId: string; paymentId: string; signature: string },
  patientId: string,
): Promise<{ status: PaymentStatus }> {
  const appointment = await ownAppointment(input.appointmentId, patientId);

  // Replaying a successful verification must not credit twice. Answering with
  // the state it is already in is both idempotent and honest.
  if (appointment.payment?.status === 'paid') return { status: 'paid' };

  if (appointment.payment?.orderId !== input.orderId) {
    // The order has to be the one this server created for this appointment,
    // or a valid signature from some other order would settle this one.
    throw ApiError.badRequest('That payment does not belong to this appointment.');
  }

  const ok = payments().verifySignature({
    orderId: input.orderId,
    paymentId: input.paymentId,
    signature: input.signature,
  });

  if (!ok) {
    logger.warn('A payment signature did not verify', {
      appointmentId: input.appointmentId,
      orderId: input.orderId,
    });

    await PaymentModel.updateOne(
      { gatewayOrderId: input.orderId },
      { $set: { status: 'failed', gatewayPaymentId: input.paymentId, signatureVerified: false } },
    );
    appointment.set('payment.status', 'failed');
    await appointment.save();

    throw ApiError.badRequest('That payment could not be verified.');
  }

  await settle(appointment, input.orderId, input.paymentId);
  return { status: 'paid' };
}

/**
 * Settles an order the *mock* provider created.
 *
 * The mock signs its orders with a per-process secret, which the client has no
 * way to compute — so there is no signature for a browser to send back and the
 * demo would stall at "pending" forever. This is the stand-in for a checkout
 * widget that is not there.
 *
 * Gated hard on the provider actually being the mock. If this were reachable
 * while a real gateway were configured it would be an endpoint for marking any
 * appointment paid without paying, which is the single worst thing this module
 * could offer.
 */
export async function confirmMockPayment(
  appointmentId: string,
  patientId: string,
): Promise<{ status: PaymentStatus }> {
  const provider = payments();
  if (provider.name !== 'mock') {
    throw ApiError.conflict('This payment has to go through the gateway.');
  }

  const appointment = await ownAppointment(appointmentId, patientId);
  if (appointment.payment?.status === 'paid') return { status: 'paid' };

  const orderId = appointment.payment?.orderId;
  if (!orderId) throw ApiError.conflict('That payment has not been started.');

  await settle(appointment, orderId, `pay_mock_${orderId.slice(-10)}`);
  return { status: 'paid' };
}

/**
 * Marks an appointment paid. The one place that does.
 *
 * Called from verification and from the webhook, which is exactly why it checks
 * first: the two arrive independently and often both, and the second must be a
 * no-op rather than a second credit.
 */
async function settle(
  appointment: AppointmentDocument,
  orderId: string,
  paymentId: string,
): Promise<boolean> {
  if (appointment.payment?.status === 'paid') return false;

  await PaymentModel.updateOne(
    { gatewayOrderId: orderId },
    { $set: { status: 'paid', gatewayPaymentId: paymentId, signatureVerified: true } },
  );

  appointment.set('payment.status', 'paid');
  appointment.set('payment.paymentId', paymentId);
  await appointment.save();
  return true;
}

/**
 * Refunds whatever was actually captured for an appointment.
 *
 * Best effort on purpose. The appointment is cancelled either way — a gateway
 * that will not refund right now is a person's job, not a 500 for the patient
 * who cancelled. The `Payment` row keeps the trail so it can be chased.
 */
export async function refundFor(appointment: AppointmentDocument): Promise<void> {
  if (appointment.payment?.status !== 'paid') return;

  const paymentId = appointment.payment.paymentId;
  if (!paymentId) {
    logger.error('An appointment is paid but carries no payment id', {
      appointmentId: String(appointment._id),
    });
    return;
  }

  try {
    const { refundId } = await payments().refund({ paymentId, amount: appointment.amount });
    await PaymentModel.updateOne(
      { appointmentId: appointment._id, gatewayPaymentId: paymentId },
      { $set: { status: 'refunded' }, $push: { raw: { refundId } } },
    );
  } catch (caught) {
    // Logged loudly and left for a human. Swallowed rather than rethrown so the
    // cancellation itself still succeeds.
    logger.error('A refund failed and needs chasing by hand', {
      appointmentId: String(appointment._id),
      paymentId,
      error: String(caught),
    });
  }
}

/**
 * A gateway callback.
 *
 * Signed over the raw bytes with the webhook secret, which is a different secret
 * from the API one — and checked before the payload is trusted for anything at
 * all. An unsigned or wrongly signed webhook is not an error to report back in
 * detail; it is somebody probing.
 */
export async function handleWebhook(
  rawBody: Buffer | undefined,
  signature: string | undefined,
): Promise<{ handled: boolean }> {
  const { RAZORPAY_WEBHOOK_SECRET } = getSettings();

  if (!RAZORPAY_WEBHOOK_SECRET) {
    // Accepting unverifiable callbacks would be a way to mark anything paid.
    throw ApiError.forbidden('Webhooks are not configured.');
  }
  if (!rawBody || !signature) throw ApiError.forbidden('Unsigned webhook.');

  const expected = razorpayWebhookSignature(rawBody.toString('utf8'), RAZORPAY_WEBHOOK_SECRET);
  if (!safeEqual(signature, expected)) {
    logger.warn('A webhook arrived with a bad signature');
    throw ApiError.forbidden('That webhook did not verify.');
  }

  const event = JSON.parse(rawBody.toString('utf8')) as {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
  };

  const entity = event.payload?.payment?.entity;
  if (event.event !== 'payment.captured' || !entity?.id || !entity.order_id) {
    // Every other event is acknowledged and ignored. Answering anything but a
    // 2xx makes the gateway retry a payload we were never going to act on.
    return { handled: false };
  }

  const appointment = await AppointmentModel.findOne({ 'payment.orderId': entity.order_id });
  if (!appointment) {
    logger.warn('A webhook named an order we have no appointment for', {
      orderId: entity.order_id,
    });
    return { handled: false };
  }

  // The idempotency the exit criterion asks about: a replayed capture finds the
  // appointment already paid and changes nothing.
  const changed = await settle(appointment, entity.order_id, entity.id);
  return { handled: changed };
}

/** Every payment attempt against an appointment, newest first. For the admin. */
export async function attemptsFor(appointmentId: string) {
  return PaymentModel.find({ appointmentId: new Types.ObjectId(appointmentId) }).sort({
    createdAt: -1,
  });
}
