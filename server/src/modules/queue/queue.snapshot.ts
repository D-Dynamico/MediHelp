import { Types } from 'mongoose';
import type { QueueSnapshotDto, Speciality } from '@shared/types.js';
import { AppointmentModel, DoctorModel, QueueSessionModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { dayFromKey, dayKeyUtc, endOfDayUtc, startOfDayUtc } from '../../utils/dates.js';
import { emitQueueUpdate } from '../../realtime/io.js';

/**
 * Building and broadcasting the public queue snapshot.
 *
 * Kept apart from `queue.service.ts` on purpose. The appointment service also
 * has to broadcast — cancelling or completing from the appointments table
 * changes the queue just as much as the queue screen does — and if the
 * broadcast lived beside the queue's own actions the two services would import
 * each other. This module reads models and emits; it calls no service.
 */

/**
 * The queue session for a doctor's day, created the first time it is needed.
 *
 * An upsert rather than a find-then-create: two people opening the board at the
 * same moment would both find nothing and both insert, and the unique index
 * would turn one of them into a 500. `$setOnInsert` means the document is only
 * ever initialised once, so an upsert racing with a real update cannot reset
 * `currentToken` to zero mid-morning.
 */
export async function sessionFor(doctorId: Types.ObjectId | string, day: Date) {
  const id = new Types.ObjectId(String(doctorId));
  const session = await QueueSessionModel.findOneAndUpdate(
    { doctorId: id, date: startOfDayUtc(day) },
    { $setOnInsert: { currentToken: 0, servedCount: 0 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  // An upsert returning the document after the write always has one; the
  // assertion is for the type, not for a case that happens.
  if (!session) throw ApiError.notFound('No queue for that doctor.');
  return session;
}

/**
 * The snapshot everyone in the room sees.
 *
 * Numbers only — see `QueueSnapshotDto`. `waiting` is every checked-in patient
 * in token order, which is the order they will be called, so a client can work
 * out its own position without the server holding one snapshot per patient.
 *
 * The token being seen comes from the appointment currently `in_progress`
 * rather than from the session's own `currentToken`, with the session as the
 * fallback. The appointment is the fact; the session is a cache of it, and when
 * the two disagree — a consult completed from the appointments table, say — the
 * fact should win.
 */
export async function buildSnapshot(
  doctorId: Types.ObjectId | string,
  day: Date,
): Promise<QueueSnapshotDto> {
  const id = new Types.ObjectId(String(doctorId));

  const doctor = await DoctorModel.findById(id).select('speciality medianConsultMins userId');
  if (!doctor) throw ApiError.notFound('No doctor with that id.');
  const account = await doctor.populate<{ userId: { name: string } }>('userId', 'name');

  const [session, rows] = await Promise.all([
    sessionFor(id, day),
    AppointmentModel.find({
      doctorId: id,
      slotStart: { $gte: startOfDayUtc(day), $lt: endOfDayUtc(day) },
      status: { $in: ['checked_in', 'in_progress'] },
    })
      .select('tokenNumber status')
      .sort({ tokenNumber: 1 })
      .lean(),
  ]);

  const serving = rows.find((row) => row.status === 'in_progress');

  return {
    doctorId: String(id),
    doctorName: account.userId.name,
    speciality: doctor.speciality as Speciality,
    date: dayKeyUtc(day),
    currentToken: serving?.tokenNumber ?? session.currentToken ?? 0,
    waiting: rows.filter((row) => row.status === 'checked_in').map((row) => row.tokenNumber),
    medianConsultMins: doctor.medianConsultMins,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Counts one more patient through the day.
 *
 * Lives here rather than in the queue's own actions because a doctor may finish
 * a consult from the appointments table as easily as from the queue screen, and
 * a tally that only counted one of those routes would be wrong by lunchtime.
 */
export async function recordServed(doctorId: Types.ObjectId | string, day: Date): Promise<void> {
  await sessionFor(doctorId, day);
  await QueueSessionModel.updateOne(
    { doctorId: new Types.ObjectId(String(doctorId)), date: startOfDayUtc(day) },
    { $inc: { servedCount: 1 } },
  );
}

/**
 * What a joining socket is handed, so a screen is never blank while it waits for
 * something to happen. Answers null rather than throwing: a board link naming a
 * doctor who has since been removed should show nothing, not break the socket.
 */
export const snapshotProvider = async (
  doctorId: string,
  dateKey: string,
): Promise<QueueSnapshotDto | null> => {
  try {
    return await buildSnapshot(doctorId, dayFromKey(dateKey));
  } catch {
    return null;
  }
};

/**
 * Rebuilds the snapshot and pushes it to the room.
 *
 * Never throws into the caller. A broadcast that fails must not turn a consult
 * that was completed into an error for the doctor who completed it — the write
 * already happened, and the next event or page load repairs the screens.
 */
export async function broadcastQueue(
  doctorId: Types.ObjectId | string,
  day: Date,
): Promise<QueueSnapshotDto | null> {
  try {
    const snapshot = await buildSnapshot(doctorId, day);
    emitQueueUpdate(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}
