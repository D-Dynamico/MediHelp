import { z } from 'zod';
import { PAYMENT_MODES } from '@shared/types.js';
import { isDayKey } from '../../utils/dates.js';
import { objectIdParamSchema } from '../doctors/doctor.schema.js';

/** Every waitlist request, validated at the route boundary. */

export const joinWaitlistSchema = z.object({
  doctorId: objectIdParamSchema.shape.id,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-15.')
    .refine(isDayKey, 'That is not a real date.'),
});

export const entryParamSchema = objectIdParamSchema;

/**
 * Only the payment mode. The slot, the doctor and the fee all come from the
 * offer and the doctor record — a claim that could name its own slot would be
 * a way to book any time at all by pointing at any open offer.
 */
export const claimSchema = z.object({
  mode: z.enum(PAYMENT_MODES, { error: 'Choose how you would like to pay.' }),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
export type ClaimInput = z.infer<typeof claimSchema>;
