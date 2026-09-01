import { z } from 'zod';

/**
 * What the payment endpoints accept.
 *
 * No amount appears anywhere. It is read from the appointment, which took it
 * from the doctor record at booking time — a field the client cannot send is a
 * field nobody has to remember to ignore.
 */

export const createOrderSchema = z.object({
  appointmentId: z.string().length(24, 'That is not a valid appointment.'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * What comes back from a checkout. The three gateway fields are opaque strings
 * here; only the HMAC over them decides whether they mean anything.
 */
export const verifyPaymentSchema = z.object({
  appointmentId: z.string().length(24, 'That is not a valid appointment.'),
  orderId: z.string().min(1).max(120),
  paymentId: z.string().min(1).max(120),
  signature: z.string().min(1).max(256),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
