import { z } from 'zod';
import { isDayKey } from '../../utils/dates.js';
import { objectIdParamSchema } from '../doctors/doctor.schema.js';

/** Every queue request, and the socket's join message, validated at the boundary. */

/** The same id rule as everywhere else, so the two cannot drift apart. */
const objectId = objectIdParamSchema.shape.id;

/**
 * A day as "YYYY-MM-DD", UTC, that actually exists. 2026-02-31 matches the
 * shape and is refused: `new Date` would roll it into March and answer about a
 * day nobody asked for.
 */
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date like 2026-09-03')
  .refine(isDayKey, 'That is not a real date.');

/**
 * Optional everywhere over HTTP — the queue screens are about today, and the
 * parameter exists so a doctor can look back at yesterday rather than because
 * anything routinely sends it.
 */
export const queueDaySchema = z.object({ date: dayKey.optional() });

export const appointmentParamSchema = objectIdParamSchema;

/**
 * The board's credentials. The doctor id in the path is only ever compared with
 * the one inside the token — it is never what the query runs on.
 */
export const boardParamSchema = z.object({ doctorId: objectId });
export const boardQuerySchema = z.object({ t: z.string().min(1, 'a board link is required') });

/**
 * What a socket sends to join a queue room. The same rules as the HTTP routes,
 * rather than a hand-written copy in the socket file that would stop agreeing
 * with these the first time either was tightened.
 */
export const queueJoinSchema = z.object({ doctorId: objectId, date: dayKey });

export type QueueDayQuery = z.infer<typeof queueDaySchema>;
export type BoardQuery = z.infer<typeof boardQuerySchema>;
