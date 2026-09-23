import { Types } from 'mongoose';
import type {
  AppointmentDto,
  BoardLinkDto,
  DoctorQueueDto,
  QueueEntryDto,
  QueueSnapshotDto,
  Urgency,
} from '@shared/types.js';
import { AppointmentModel, DoctorModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { dayFromKey, dayKeyUtc, endOfDayUtc, startOfDayUtc } from '../../utils/dates.js';
import { signBoardToken } from '../../utils/tokens.js';
import {
  completeAppointment,
  markNoShow,
  startConsult,
  type Actor,
} from '../appointments/appointment.service.js';
import { broadcastQueue, buildSnapshot } from './queue.snapshot.js';

/**
 * The doctor's controls over their own queue.
 *
 * Like the rest of /api/doctor, there is no doctor id in any of these routes:
 * the doctor is whoever the token belongs to, looked up by `userId`. That makes
 * ownership a property of the query rather than a check that can be forgotten —
 * except on the routes that name an appointment, where the appointment's own
 * `doctorId` is compared with the caller's before anything is written.
 */

/** The signed-in doctor's own record. */
async function ownDoctor(userId: string) {
  const doctor = await DoctorModel.findOne({ userId }).select('_id medianConsultMins');
  if (!doctor) {
    throw ApiError.notFound('Your doctor profile is missing. Ask an admin to check the account.');
  }
  return doctor;
}

/** The day a queue request is about. Defaults to today; always a UTC day. */
function dayOf(dateKey?: string): Date {
  return dateKey ? dayFromKey(dateKey) : startOfDayUtc();
}

/**
 * Everyone on a doctor's list for the day, in token order, with the names.
 *
 * This is the authenticated companion to the socket snapshot. The snapshot says
 * *what changed* and carries numbers only; this says *who*, and only a signed-in
 * doctor looking at their own day ever sees it.
 */
export async function doctorQueue(
  userId: string,
  dateKey?: string,
  /** One just built for the broadcast, so an action does not build it twice. */
  built?: QueueSnapshotDto | null,
): Promise<DoctorQueueDto> {
  const doctor = await ownDoctor(userId);
  const day = dayOf(dateKey);

  const [snapshot, rows] = await Promise.all([
    built ?? buildSnapshot(doctor._id, day),
    AppointmentModel.find({
      doctorId: doctor._id,
      slotStart: { $gte: startOfDayUtc(day), $lt: endOfDayUtc(day) },
      // Cancelled appointments are not on the list. Nobody is waiting for them,
      // and a struck-through row in a queue the doctor is working through is
      // noise at exactly the wrong moment.
      status: { $ne: 'cancelled' },
    })
      .select('tokenNumber status slotStart checkedInAt patientId triageId')
      .populate<{ patientId: { name: string; image?: string } | null }>('patientId', 'name image')
      .populate<{ triageId: { urgency: Urgency } | null }>('triageId', 'urgency')
      .sort({ tokenNumber: 1 })
      .lean(),
  ]);

  const now = Date.now();
  const entries: QueueEntryDto[] = rows.map((row) => ({
    appointmentId: String(row._id),
    tokenNumber: row.tokenNumber,
    // A deleted patient account would leave the reference dangling. The row
    // still matters to the doctor's day, so it is shown rather than dropped.
    patientName: row.patientId?.name ?? 'Unknown patient',
    ...(row.patientId?.image ? { patientImage: row.patientId.image } : {}),
    slotStart: row.slotStart.toISOString(),
    status: row.status,
    ...(row.checkedInAt
      ? { waitingMins: Math.max(0, Math.round((now - row.checkedInAt.getTime()) / 60_000)) }
      : {}),
    ...(row.triageId?.urgency ? { urgency: row.triageId.urgency } : {}),
  }));

  return { snapshot, entries };
}

/** Loads an appointment and refuses unless it belongs to the signed-in doctor. */
async function ownAppointment(userId: string, appointmentId: string) {
  const doctor = await ownDoctor(userId);
  const appointment = await AppointmentModel.findById(appointmentId).select(
    'doctorId slotStart status checkedInAt',
  );
  // 404 rather than 403 for someone else's appointment, so the route cannot be
  // used to find out which ids exist.
  if (!appointment || String(appointment.doctorId) !== String(doctor._id)) {
    throw ApiError.notFound('No appointment with that id.');
  }
  return { doctor, appointment };
}

/**
 * Marks a patient present at the desk.
 *
 * Only from `booked`. Checking in twice is refused rather than ignored, because
 * the second call would move `checkedInAt` forward and quietly reset the waiting
 * time the doctor reads to decide who has been kept longest.
 */
export async function checkIn(userId: string, appointmentId: string): Promise<DoctorQueueDto> {
  const { appointment } = await ownAppointment(userId, appointmentId);

  if (appointment.status === 'checked_in') {
    throw ApiError.conflict('That patient is already checked in.');
  }
  if (appointment.status !== 'booked') {
    throw ApiError.conflict('That appointment is not waiting to be checked in.');
  }

  appointment.status = 'checked_in';
  appointment.checkedInAt = new Date();
  await appointment.save();

  const snapshot = await broadcastQueue(appointment.doctorId, appointment.slotStart);
  return doctorQueue(userId, dayKeyUtc(appointment.slotStart), snapshot);
}

/**
 * Calls the next patient in.
 *
 * The lowest waiting token, which is the earliest slot — not the earliest
 * arrival. Someone who turns up at 09:00 for a 10:30 appointment has not moved
 * ahead of the 09:20 one by being early.
 *
 * Refuses while somebody is already in the room. The alternative — quietly
 * completing the current consult — would record a length nobody measured and
 * mark a patient seen on the strength of a mis-click. Two taps is the right
 * price for that.
 */
export async function callNext(userId: string, dateKey?: string): Promise<DoctorQueueDto> {
  const doctor = await ownDoctor(userId);
  const day = dayOf(dateKey);
  const window = { $gte: startOfDayUtc(day), $lt: endOfDayUtc(day) };

  const next = await AppointmentModel.findOne({
    doctorId: doctor._id,
    slotStart: window,
    status: 'checked_in',
  })
    .select('_id tokenNumber')
    .sort({ tokenNumber: 1 });

  if (!next) throw ApiError.conflict('Nobody is checked in and waiting.');

  // The shared transition does the rest: it refuses while somebody is already
  // in the room, stamps `consultStartedAt` exactly once, and records the called
  // token on the session — so "started" means the same thing here as it does in
  // the appointments table, and the board moves either way.
  await startConsult(String(next._id), { userId, role: 'doctor' });

  return doctorQueue(userId, dateKey);
}

/** Finishes a consult. Delegates to the shared transition, then re-reads the list. */
export async function complete(
  userId: string,
  appointmentId: string,
): Promise<{ appointment: AppointmentDto; queue: DoctorQueueDto }> {
  const { appointment: row } = await ownAppointment(userId, appointmentId);
  const actor: Actor = { userId, role: 'doctor' };
  const appointment = await completeAppointment(appointmentId, actor);
  return { appointment, queue: await doctorQueue(userId, dayKeyUtc(row.slotStart)) };
}

/** Marks the called patient as not having turned up. */
export async function noShow(
  userId: string,
  appointmentId: string,
): Promise<{ appointment: AppointmentDto; queue: DoctorQueueDto }> {
  const { appointment: row } = await ownAppointment(userId, appointmentId);
  const actor: Actor = { userId, role: 'doctor' };
  const appointment = await markNoShow(appointmentId, actor);
  return { appointment, queue: await doctorQueue(userId, dayKeyUtc(row.slotStart)) };
}

/**
 * A link that opens this doctor's waiting-room board with no login.
 *
 * Minted on request rather than stored, so there is no list of live board links
 * to leak and no revocation story to get wrong — a link stops working after
 * thirty days and the doctor asks for another.
 */
export async function boardLink(userId: string): Promise<BoardLinkDto> {
  const doctor = await ownDoctor(userId);
  const { token, expiresAt } = signBoardToken(String(doctor._id));
  return {
    path: `/board/${String(doctor._id)}?t=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * The board's own read, for a screen holding a board token and nothing else.
 *
 * Takes the doctor id the token was verified to name, never one from the URL —
 * otherwise one valid link would read every other doctor's queue by editing the
 * path.
 */
export async function boardSnapshot(doctorId: string): Promise<QueueSnapshotDto> {
  return buildSnapshot(new Types.ObjectId(doctorId), startOfDayUtc());
}
