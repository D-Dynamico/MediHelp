import { z } from 'zod';
import { SPECIALITIES } from '@shared/types.js';
import { findAvailabilityProblems } from '../../utils/availability.js';

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

/**
 * A number that arrived as text, where a blank box is a mistake rather than a
 * zero.
 *
 * `Number('')` is 0 and zod's coercion accepts it happily, so a doctor who
 * cleared the fee box to retype it and mis-clicked Save would have stored
 * themselves as free to book — and been told "Saved." An absent field still
 * means "not changed"; that is what `.partial()` below is for. An empty one is
 * refused before coercion can turn it into a number nobody typed.
 */
const filled = <T extends z.ZodType>(schema: T) =>
  z.preprocess((raw) => (typeof raw === 'string' && raw.trim() === '' ? undefined : raw), schema);

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
    fees: filled(
      z.coerce.number({ error: 'Enter the fee.' }).int().min(0).max(1_000_000),
    ),
    addressLine1: z.string().trim().min(3, 'Enter the clinic address.').max(200),
    addressLine2: z.string().trim().max(200),
    available: z.union([z.boolean(), z.enum(['true', 'false'])]).transform((v) => v === true || v === 'true'),
    slotDurationMins: filled(
      z.coerce
        .number({ error: 'Enter the appointment length.' })
        .int()
        .min(5, 'Appointments cannot be shorter than 5 minutes.')
        .max(120, 'Appointments cannot be longer than 2 hours.'),
    ),
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
      .pipe(
        z
          .array(workingHoursEntrySchema)
          .max(21, 'That is more sittings than a week holds.')
          // Checked here rather than in the service, so a bad grid is a 422 with
          // per-row messages like every other validation failure, and never
          // reaches the database.
          .superRefine((windows, ctx) => {
            for (const problem of findAvailabilityProblems(windows)) {
              ctx.addIssue({
                code: 'custom',
                path: [problem.index],
                message: problem.message,
              });
            }
          }),
      ),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Which slice of a doctor's appointments to show.
 *
 * A named scope rather than a free date range: these are the three questions a
 * doctor actually asks — what is left today, what is coming, what has been.
 */
export const appointmentScopeSchema = z.object({
  when: z.enum(['today', 'upcoming', 'past', 'all']).default('upcoming'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AppointmentScope = z.infer<typeof appointmentScopeSchema>;

/** Just the slice, without the paging that travels with it on the query string. */
export type AppointmentWhen = AppointmentScope['when'];

export const objectIdParamSchema = z.object({
  id: z.string().length(24, 'That is not a valid id.'),
});

/* ------------------------------------------------------ public catalogue --- */

/**
 * What a visitor may narrow the doctor list by.
 *
 * The speciality is an enum rather than free text — it is what the list filters
 * on, and a typo would silently return nothing rather than saying so. The search
 * term is capped because it becomes a regex, and an unbounded one is a pattern
 * the database has to build on every request.
 */
export const publicDoctorQuerySchema = z.object({
  speciality: z.enum(SPECIALITIES).optional(),
  search: z.string().trim().max(80, 'That search is too long.').optional(),
});

export type PublicDoctorQuery = z.infer<typeof publicDoctorQuerySchema>;

/** The date a patient is asking a doctor's free slots for. */
export const slotQuerySchema = z.object({
  /**
   * A plain calendar day, not an instant. Slots are generated from the doctor's
   * wall-clock working hours for that weekday, so the time of day a client
   * happened to ask at has no place in the question.
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-15.')
    .optional(),
});

export type SlotQuery = z.infer<typeof slotQuerySchema>;
