import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { createOrderSchema, verifyPaymentSchema } from './payment.schema.js';
import * as controller from './payment.controller.js';

/**
 * Payments, mounted at /api/payments.
 *
 * The webhook is deliberately outside the auth guard: it is called by the
 * gateway, which has no session and never will. What stands in for a token
 * there is the HMAC over the raw body, checked in the service before the
 * payload is trusted for anything — so the route is open but the handler is not.
 */
export const paymentRouter = Router();

// Declared before the guard below, so it does not inherit it.
paymentRouter.post('/webhook', controller.webhook);

paymentRouter.use(requireAuth, requireRole('patient'));

paymentRouter.post(
  '/order',
  validate({ body: createOrderSchema }),
  controller.createOrder,
);

/**
 * Only ever does anything while the mock provider is in play — the service
 * refuses otherwise. It is what stands in for a checkout widget when there are
 * no gateway keys.
 */
paymentRouter.post(
  '/confirm-mock',
  validate({ body: createOrderSchema }),
  controller.confirmMock,
);

paymentRouter.post(
  '/verify',
  validate({ body: verifyPaymentSchema }),
  controller.verify,
);
