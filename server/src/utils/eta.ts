import { Types } from 'mongoose';
import { AppointmentModel, DoctorModel } from '../models/index.js';

export { etaMinutes, etaText, positionOf, DEFAULT_CONSULT_MINS } from '@shared/queue.js';

/**
 * Keeping a doctor's typical consult length honest.
 *
 * The wait a patient reads is `peopleAhead × medianConsultMins`, so this number
 * is the whole difference between a real estimate and the fixed fifteen-minute
 * guess every clinic website shows. It is recomputed on each completion from the
 * doctor's **last twenty finished consults**, and stored on the doctor record so
 * the socket path never has to aggregate anything.
 */

/** How many recent consults the figure is drawn from. */
const WINDOW = 20;

/**
 * A consult shorter than a minute is a double-tap; one longer than four hours is
 * a doctor who forgot to press "complete" before going home. Neither is a
 * measurement, and letting either in would move the estimate for every patient
 * after them.
 */
const MIN_MINUTES = 1;
const MAX_MINUTES = 240;

/** The middle value, averaging the two middles on an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Recomputes and stores a doctor's median consult length.
 *
 * A true median over a window, not a rolling average. The average was the
 * cheaper thing to keep and it is the wrong shape for this: one consult that ran
 * ninety minutes because a patient needed ninety minutes would drag every
 * estimate afterwards, and a median simply steps past it. Twenty rows sorted by
 * a stored field is a small query, and it only runs when a consult ends.
 *
 * Returns the new figure, or null when there is not yet anything to learn from —
 * in which case the doctor keeps whatever they had.
 */
export async function refreshMedianConsultMins(
  doctorId: Types.ObjectId | string,
): Promise<number | null> {
  const id = new Types.ObjectId(String(doctorId));

  const rows = await AppointmentModel.find({
    doctorId: id,
    status: 'completed',
    consultStartedAt: { $ne: null },
    consultEndedAt: { $ne: null },
  })
    .select('consultStartedAt consultEndedAt')
    .sort({ consultEndedAt: -1 })
    .limit(WINDOW)
    .lean();

  const minutes = rows
    .map((row) =>
      Math.round((row.consultEndedAt!.getTime() - row.consultStartedAt!.getTime()) / 60_000),
    )
    .filter((value) => value >= MIN_MINUTES && value <= MAX_MINUTES);

  const next = median(minutes);
  if (next === null) return null;

  await DoctorModel.updateOne({ _id: id }, { $set: { medianConsultMins: next } });
  return next;
}
