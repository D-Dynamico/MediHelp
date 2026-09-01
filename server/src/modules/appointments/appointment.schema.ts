import { z } from 'zod';
import { PAYMENT_MODES } from '@shared/types.js';

/** What the patient-facing appointment endpoints accept. */

/**
 * A booking request.
 *
 * Note what is *not* here: no amount, no fee, no token number, no doctor name.
 * Every one of those is derived on the server. A field the client cannot send
 * is a field nobody has to remember to ignore, and zod strips anything not
 * declared here before a handler ever sees the body.
 */
export const bookingSchema = z.object({
  doctorId: z.string().length(24, 'Pick a doctor.'),
  /**
   * The exact start of a slot the doctor offers, as an ISO instant. It is
   * checked against the freshly generated grid rather than taken on trust — the
   * client having been shown this time is not evidence it is still one.
   */
  slotStart: z.coerce.date({ error: 'Pick a time.' }),
  mode: z.enum(PAYMENT_MODES, { error: 'Choose how you would like to pay.' }),
  triageId: z.string().length(24).optional(),
});

export type BookingInput = z.infer<typeof bookingSchema>;

/**
 * Which of their own appointments a patient is asking for.
 *
 * The same three questions a doctor asks, for the same reason: what is coming,
 * what has been, everything.
 */
export const myAppointmentsSchema = z.object({
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type MyAppointmentsQuery = z.infer<typeof myAppointmentsSchema>;

export const appointmentIdParamSchema = z.object({
  id: z.string().length(24, 'That is not a valid id.'),
});
