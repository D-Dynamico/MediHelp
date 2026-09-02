import { z } from 'zod';
import { GENDERS } from '@shared/types.js';

/**
 * What a patient may change about themselves.
 *
 * Not their email and not their role. The email is the account identifier and
 * changing it is an account-recovery flow of its own — one that has to prove the
 * new address before the old one stops working, or a typo locks someone out of
 * their own medical history. The role is never in a body anywhere in this app.
 *
 * An absent field means "not changed". An empty one means "clear it", which is a
 * different thing and a patient is entitled to both: a phone number, a date of
 * birth and a gender are all optional on the account, so having no way to take
 * one back off once it had been set was a gap rather than a policy.
 */

export const updatePatientSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name.').max(120),
    phone: z.string().trim().max(20),
    /**
     * A plain calendar date. It is what the doctor's list shows an age from, so
     * a date in the future is a typo worth catching rather than a negative age
     * to render.
     */
    dob: z.literal('').or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 1994-04-12.')
        .refine((value) => new Date(value).getTime() < Date.now(), 'That date is in the future.'),
    ),
    gender: z.literal('').or(z.enum(GENDERS, { error: 'Pick one of the options.' })),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
