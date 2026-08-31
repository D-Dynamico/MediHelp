import { z } from 'zod';
import { APPOINTMENT_STATUSES, SPECIALITIES } from '@shared/types.js';

/**
 * What the admin endpoints accept.
 *
 * The doctor forms arrive as multipart, so every field is a string on the wire
 * — `fees` comes in as `"500"`, `available` as `"true"`. The coercions here are
 * the boundary where that becomes typed data; nothing downstream should be
 * parsing strings again.
 */

/** A number that arrived as text from a multipart form. */
const numeric = (label: string) =>
  z.coerce.number({ error: `${label} must be a number.` });

/** A checkbox that arrived as text. Absent means "not changed". */
const boolish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const workingHoursEntry = z.object({
  /** 0 = Sunday, matching `Date.getDay()`. */
  day: numeric('Day').int().min(0).max(6),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 17:00.'),
});

/**
 * The doctor's own fields, shared by create and edit. Speciality is checked
 * against the list rather than accepted as free text: it drives the public
 * filter and the triage routing, and a typo would make a doctor unfindable.
 */
const doctorProfileFields = {
  speciality: z.enum(SPECIALITIES, { error: 'Choose one of the listed specialities.' }),
  degree: z.string().trim().min(2, 'Enter the qualification.').max(120),
  experience: numeric('Years of experience').int().min(0).max(70),
  about: z.string().trim().min(20, 'Write at least a sentence or two.').max(2000),
  fees: numeric('The fee').int().min(0).max(1_000_000),
  addressLine1: z.string().trim().min(3, 'Enter the clinic address.').max(200),
  addressLine2: z.string().trim().max(200).optional(),
  available: boolish.optional(),
  slotDurationMins: numeric('The slot length').int().min(5).max(120).optional(),
};

export const createDoctorSchema = z.object({
  name: z.string().trim().min(2, 'Enter the doctor’s name.').max(120),
  email: z.email('Enter a valid email address.').max(200).transform((v) => v.trim().toLowerCase()),
  // The admin sets the first password and passes it on; the doctor changes it.
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  phone: z.string().trim().max(20).optional(),
  ...doctorProfileFields,
});

/** Every field optional — an edit changes only what it names. */
export const updateDoctorSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(20).optional(),
    ...doctorProfileFields,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

export const doctorListQuerySchema = z.object({
  speciality: z.enum(SPECIALITIES).optional(),
  /** Matches a name or an email, case-insensitively. */
  search: z.string().trim().max(120).optional(),
  /** Admins see removed doctors too, but only when they ask. */
  includeInactive: boolish.optional(),
});

export const appointmentListQuerySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  doctorId: z.string().length(24, 'That is not a doctor id.').optional(),
  patientId: z.string().length(24, 'That is not a patient id.').optional(),
  /** ISO dates, inclusive of `from`, exclusive of the day after `to`. */
  from: z.iso.date('Use a date like 2026-09-01.').optional(),
  to: z.iso.date('Use a date like 2026-09-30.').optional(),
  page: numeric('The page').int().min(1).default(1),
  pageSize: numeric('The page size').int().min(1).max(100).default(20),
});

export const objectIdParamSchema = z.object({
  id: z.string().length(24, 'That is not a valid id.'),
});

export const workingHoursSchema = z.array(workingHoursEntry).max(21);

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type DoctorListQuery = z.infer<typeof doctorListQuerySchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
