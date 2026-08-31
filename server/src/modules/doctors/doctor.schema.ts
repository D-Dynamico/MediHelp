import { z } from 'zod';

/**
 * What a doctor may change about themselves.
 *
 * Deliberately narrower than what an admin may change. A doctor cannot edit
 * their own speciality, degree or years of experience: those are the clinic's
 * claims about their credentials, and letting the account holder rewrite them
 * would make the public listing self-certified. They set their own fee, hours
 * and description, because those are theirs.
 */

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 09:00.');

export const workingHoursEntrySchema = z.object({
  /** 0 = Sunday, matching `Date.getDay()`. */
  day: z.coerce.number().int().min(0, 'Pick a weekday.').max(6, 'Pick a weekday.'),
  start: time,
  end: time,
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your name.').max(120),
    phone: z.string().trim().max(20),
    about: z.string().trim().min(20, 'Write at least a sentence or two.').max(2000),
    fees: z.coerce.number({ error: 'The fee must be a number.' }).int().min(0).max(1_000_000),
    addressLine1: z.string().trim().min(3, 'Enter the clinic address.').max(200),
    addressLine2: z.string().trim().max(200),
    available: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true'),
    slotDurationMins: z.coerce
      .number({ error: 'The appointment length must be a number.' })
      .int()
      .min(5, 'Appointments cannot be shorter than 5 minutes.')
      .max(120, 'Appointments cannot be longer than 2 hours.'),
    /**
     * Sent as a JSON string, because the rest of the form is multipart and
     * multipart has no agreed way to carry an array of objects.
     */
    workingHours: z
      .string()
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'The working hours were not readable.' });
          return z.NEVER;
        }
      })
      .pipe(z.array(workingHoursEntrySchema).max(21, 'That is more sittings than a week holds.')),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Which slice of a doctor's appointments to show. */
export const appointmentScopeSchema = z.object({
  when: z.enum(['today', 'upcoming', 'past', 'all']).default('upcoming'),
});

export type AppointmentScope = z.infer<typeof appointmentScopeSchema>;
