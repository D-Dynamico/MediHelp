import { z } from 'zod';
import { GENDERS } from '@shared/types.js';

/**
 * What a patient may change about themselves.
 *
 * Not their email and not their role. The email is the account identifier and
 * changing it is an account-recovery flow of its own — one that has to prove the
 * new address before the old one stops working, or a typo locks someone out of
 * their own medical history. The role is never in a body anywhere in this app.
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
    dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 1994-04-12.')
      .refine((value) => new Date(value).getTime() < Date.now(), 'That date is in the future.'),
    gender: z.enum(GENDERS, { error: 'Pick one of the options.' }),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
