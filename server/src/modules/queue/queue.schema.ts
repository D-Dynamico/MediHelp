import { z } from 'zod';

/** Every queue request body and query, validated at the route boundary. */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'expected an id');

/**
 * A day as "YYYY-MM-DD", UTC. Optional everywhere — the queue screens are about
 * today, and the parameter exists so a doctor can look back at yesterday rather
 * than because anything routinely sends it.
 */
export const queueDaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date like 2026-09-03')
    .optional(),
});

export const appointmentParamSchema = z.object({ id: objectId });

/**
 * The board's credentials. The doctor id in the path is only ever compared with
 * the one inside the token — it is never what the query runs on.
 */
export const boardParamSchema = z.object({ doctorId: objectId });
export const boardQuerySchema = z.object({ t: z.string().min(1, 'a board link is required') });

export type QueueDayQuery = z.infer<typeof queueDaySchema>;
export type BoardQuery = z.infer<typeof boardQuerySchema>;
