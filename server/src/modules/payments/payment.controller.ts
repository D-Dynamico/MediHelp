import type { RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as service from './payment.service.js';
import type { CreateOrderInput, VerifyPaymentInput } from './payment.schema.js';

/** The HTTP layer for payments. Rules live in the service. */

export const createOrder: RequestHandler = async (req, res) => {
  const { appointmentId } = req.body as CreateOrderInput;
  const order = await service.createOrder(appointmentId, req.auth!.userId);

  await audit(req, 'payment.order', { type: 'Appointment', id: appointmentId }, {
    orderId: order.orderId,
  });
  res.status(201).json({ order });
};

export const verify: RequestHandler = async (req, res) => {
  const input = req.body as VerifyPaymentInput;
  const result = await service.verifyPayment(input, req.auth!.userId);

  await audit(req, 'payment.verify', { type: 'Appointment', id: input.appointmentId }, {
    orderId: input.orderId,
  });
  res.json(result);
};

/**
 * Settles a mock payment. Refused outright when a real gateway is configured.
 */
export const confirmMock: RequestHandler = async (req, res) => {
  const { appointmentId } = req.body as CreateOrderInput;
  const result = await service.confirmMockPayment(appointmentId, req.auth!.userId);

  await audit(req, 'payment.confirm.mock', { type: 'Appointment', id: appointmentId });
  res.json(result);
};

/**
 * The gateway's own callback.
 *
 * Answers 200 to anything that verifies, including events it does nothing with:
 * a non-2xx makes the gateway retry a payload we were never going to act on.
 * A bad signature is the one case that does not get a 200 — that is somebody
 * probing, not a delivery worth repeating.
 */
export const webhook: RequestHandler = async (req, res) => {
  const signature = req.header('x-razorpay-signature');
  const result = await service.handleWebhook(req.rawBody, signature);
  res.json({ ok: true, ...result });
};
