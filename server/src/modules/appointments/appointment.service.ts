import type { PipelineStage } from 'mongoose';
import { Types } from 'mongoose';
import type { AppointmentDto, AppointmentStatus, Role } from '@shared/types.js';
import { AppointmentModel, DoctorModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { logger } from '../../config/logger.js';
import { patientLookupStages, toAppointmentDto, type AppointmentRow } from './appointment.mapper.js';

/**
 * The rules for changing an appointment, in one place.
 *
 * Admins, doctors and patients all cancel appointments, and doctors and admins
 * both complete them. Written once per caller, those rules drift: one screen
 * forgets to release the slot, another lets a completed consult be cancelled a
 * week later. So each caller says who it is and this decides what they may do.
 */

/** Who is asking. Both fields come from the verified token, never the body. */
export interface Actor {
  userId: string;
  role: Role;
}

/** Statuses an appointment can still be acted on from. */
export const OPEN_STATUSES: readonly AppointmentStatus[] = ['booked', 'checked_in', 'in_progress'];

export interface AppointmentFilter {
  status?: AppointmentStatus | undefined;
  doctorId?: string | undefined;
  patientId?: string | undefined;
  /**
   * An instant, not a date. Callers that think in days convert first — the admin
   * turns its `to=2026-09-30` into the start of the following day — so that
   * "the whole of the 30th" and "from this moment on" are the same kind of thing
   * here rather than two overlapping ways to say when.
   */
  from?: Date | undefined;
  /** Exclusive upper bound. */
  to?: Date | undefined;
}

export interface Page {
  page: number;
  pageSize: number;
  /**
   * History reads best newest-first; a list of what is still to come reads best
   * soonest-first. Defaults to newest, which is what every backward-looking
   * caller wants.
   */
  order?: 'newest' | 'soonest';
}

export interface AppointmentPage {
  items: AppointmentDto[];
  total: number;
  page: number;
  pageSize: number;
  /** So a client can render "page 2 of 7" without doing the arithmetic. */
  pages: number;
}

/**
 * Builds the `$match` for a listing.
 *
 * Every value here comes from a zod-parsed field and is converted to its real
 * type before it goes near the query — the client's object is never spread into
 * a filter, which is the rule that stands in for `sanitizeFilter` being off.
 */
function matchFor(filter: AppointmentFilter): Record<string, unknown> {
  const match: Record<string, unknown> = {};

  if (filter.status) match.status = filter.status;
  if (filter.doctorId) match.doctorId = new Types.ObjectId(filter.doctorId);
  if (filter.patientId) match.patientId = new Types.ObjectId(filter.patientId);

  if (filter.from || filter.to) {
    const range: Record<string, Date> = {};
    if (filter.from) range.$gte = filter.from;
    if (filter.to) range.$lt = filter.to;
    match.slotStart = range;
  }

  return match;
}

/**
 * A page of appointments, newest slot first.
 *
 * The count and the page come back from one `$facet`, so paging cannot show a
 * total that disagrees with the rows beside it — which is what two separate
 * queries against a live collection will eventually do.
 */
export async function listAppointments(
  filter: AppointmentFilter,
  { page, pageSize, order = 'newest' }: Page,
): Promise<AppointmentPage> {
  const match = matchFor(filter);

  const pipeline: PipelineStage[] = [
    ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
    {
      $facet: {
        total: [{ $count: 'n' }],
        items: [
          { $sort: { slotStart: order === 'newest' ? -1 : 1 } },
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          ...patientLookupStages,
        ],
      },
    },
  ];

  const [result] = await AppointmentModel.aggregate<{
    total: { n: number }[];
    items: AppointmentRow[];
  }>(pipeline);

  const total = result?.total[0]?.n ?? 0;

  return {
    items: (result?.items ?? []).map(toAppointmentDto),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Loads an appointment or 404s. */
async function load(id: string) {
  const appointment = await AppointmentModel.findById(id);
  if (!appointment) throw ApiError.notFound('No appointment with that id.');
  return appointment;
}

/**
 * Whether this actor may touch this appointment.
 *
 * The role alone is not enough. A doctor with a perfectly valid token can put
 * another doctor's appointment id in the URL, and only this check stops them —
 * so the doctor's own `Doctor` id is looked up and compared, rather than trusted
 * from anywhere in the request.
 */
async function assertMayAct(
  appointment: { doctorId: Types.ObjectId; patientId: Types.ObjectId },
  actor: Actor,
  { patientsAllowed }: { patientsAllowed: boolean },
): Promise<void> {
  if (actor.role === 'admin') return;

  if (actor.role === 'doctor') {
    const doctor = await DoctorModel.findOne({ userId: actor.userId }).select('_id');
    if (doctor && String(doctor._id) === String(appointment.doctorId)) return;
    logger.warn('A doctor tried to act on an appointment that is not theirs', {
      userId: actor.userId,
    });
    throw ApiError.forbidden();
  }

  if (patientsAllowed && String(appointment.patientId) === actor.userId) return;

  throw ApiError.forbidden();
}

/**
 * Cancels an appointment and releases the slot.
 *
 * Releasing is not something this function does explicitly: the unique index
 * that stops double booking is partial and covers only the active statuses, so
 * moving the row to `cancelled` takes it out of the index and the slot becomes
 * bookable again. One rule, enforced by the database, rather than two states to
 * keep in step.
 */
export async function cancelAppointment(id: string, actor: Actor): Promise<AppointmentDto> {
  const appointment = await load(id);
  await assertMayAct(appointment, actor, { patientsAllowed: true });

  if (appointment.status === 'cancelled') {
    throw ApiError.conflict('That appointment is already cancelled.');
  }
  if (!OPEN_STATUSES.includes(appointment.status as AppointmentStatus)) {
    throw ApiError.conflict('A finished appointment cannot be cancelled.');
  }

  appointment.status = 'cancelled';
  appointment.cancelledBy = actor.role;
  appointment.cancelledAt = new Date();

  // Money that was actually taken has to go back. The `Payment` row and the real
  // gateway refund arrive with phase 7; this is the flag the screens read.
  //
  // Written through `set()` rather than by assignment: Mongoose types a nested
  // object as optional even where its fields are required, and the path form
  // both sidesteps that and is unambiguous about the change being tracked.
  if (appointment.payment?.status === 'paid') appointment.set('payment.status', 'refunded');

  await appointment.save();
  return present(appointment._id);
}

/**
 * Marks a consult as started.
 *
 * This is what stamps `consultStartedAt`, and therefore the only thing that
 * gives `completeAppointment` a length to learn from — without it the doctor's
 * typical consult time never moves off its default and the queue's wait
 * estimate stays a guess forever.
 *
 * Starting twice is not an error worth raising: a doctor who taps it again has
 * not done anything wrong, and moving the start time later would quietly
 * shorten the consult being measured. The first stamp wins and the call is a
 * no-op.
 */
export async function startConsult(id: string, actor: Actor): Promise<AppointmentDto> {
  const appointment = await load(id);
  await assertMayAct(appointment, actor, { patientsAllowed: false });

  if (!OPEN_STATUSES.includes(appointment.status as AppointmentStatus)) {
    throw ApiError.conflict('That appointment is no longer open.');
  }

  if (appointment.status !== 'in_progress') {
    appointment.status = 'in_progress';
    appointment.consultStartedAt ??= new Date();
    await appointment.save();
  }

  return present(appointment._id);
}

/**
 * Marks a consult done and settles a cash payment.
 *
 * Cash is `pending_at_desk` from the moment of booking until someone confirms
 * the patient actually turned up and paid — which is exactly this moment. A card
 * payment was already settled by the gateway, so it is left alone.
 */
export async function completeAppointment(id: string, actor: Actor): Promise<AppointmentDto> {
  const appointment = await load(id);
  await assertMayAct(appointment, actor, { patientsAllowed: false });

  if (appointment.status === 'completed') {
    throw ApiError.conflict('That appointment is already marked complete.');
  }
  if (!OPEN_STATUSES.includes(appointment.status as AppointmentStatus)) {
    throw ApiError.conflict('A cancelled appointment cannot be completed.');
  }

  const endedAt = new Date();
  appointment.status = 'completed';
  appointment.consultEndedAt = endedAt;

  if (appointment.payment?.mode === 'cash' && appointment.payment.status === 'pending_at_desk') {
    appointment.set('payment.status', 'paid');
  }

  await appointment.save();
  await recordConsultLength(appointment.doctorId, appointment.consultStartedAt, endedAt);

  return present(appointment._id);
}

/**
 * Keeps the doctor's typical consult length current.
 *
 * The queue's wait estimate reads this number on every socket update, so it is
 * stored rather than recomputed from the appointment history each time. Only a
 * consult that was actually started has a length worth learning from.
 */
async function recordConsultLength(
  doctorId: Types.ObjectId,
  startedAt: Date | null | undefined,
  endedAt: Date,
): Promise<void> {
  if (!startedAt) return;

  const minutes = Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000);
  // A consult that reads as zero minutes or as half a day is a clock problem or
  // a forgotten "start", not a real measurement.
  if (minutes < 1 || minutes > 240) return;

  const doctor = await DoctorModel.findById(doctorId).select('medianConsultMins');
  if (!doctor) return;

  // A rolling average rather than a true median: the real median needs the whole
  // history on every completion, and this tracks the same signal closely enough
  // for a wait estimate while staying a single small write.
  doctor.medianConsultMins = Math.round(doctor.medianConsultMins * 0.8 + minutes * 0.2);
  await doctor.save();
}

/** Re-reads one appointment through the same shape every list returns. */
async function present(id: Types.ObjectId): Promise<AppointmentDto> {
  const [row] = await AppointmentModel.aggregate<AppointmentRow>([
    { $match: { _id: id } },
    ...patientLookupStages,
  ]);
  if (!row) throw ApiError.notFound('No appointment with that id.');
  return toAppointmentDto(row);
}
