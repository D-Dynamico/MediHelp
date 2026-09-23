import type { PipelineStage } from 'mongoose';
import { Types } from 'mongoose';
import type { AppointmentDto, AppointmentStatus, PaymentMode, Role } from '@shared/types.js';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types.js';
import {
  AppointmentModel,
  DoctorModel,
  TriageAssessmentModel,
  UserModel,
  type DoctorDocument,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { logger } from '../../config/logger.js';
import { endOfDayUtc, startOfDayUtc } from '../../utils/dates.js';
import { horizonEnd, isOfferedSlot, slotsFor } from '../../utils/slots.js';
import { refreshMedianConsultMins } from '../../utils/eta.js';
import { refundFor } from '../payments/payment.service.js';
import { broadcastQueue, recordCalled, recordServed } from '../queue/queue.snapshot.js';
import {
  patientLookupStages,
  triageLookupStages,
  toAppointmentDto,
  type AppointmentRow,
} from './appointment.mapper.js';

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

/**
 * Statuses an appointment can still be acted on from. Re-exported from the
 * shared types rather than declared here: the doctor's table reads the same
 * list to decide which buttons a row gets.
 */
export const OPEN_STATUSES: readonly AppointmentStatus[] = OPEN_APPOINTMENT_STATUSES;

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
          ...triageLookupStages,
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

  // Money that was actually taken has to go back. The gateway call happens
  // first, while the row still says `paid` — `refundFor` reads that to decide
  // whether there is anything to refund, and it never throws: a gateway that
  // will not refund right now is a person's job, not a 500 for the patient who
  // cancelled.
  //
  // The status is then written through `set()` rather than by assignment:
  // Mongoose types a nested object as optional even where its fields are
  // required, and the path form both sidesteps that and is unambiguous about
  // the change being tracked.
  //
  // Only marked refunded when the money actually went back. A gateway that
  // refused leaves the row saying `paid`, which is the truth and the only thing
  // that lets anyone notice the refund still needs doing.
  if (appointment.payment?.status === 'paid' && (await refundFor(appointment))) {
    appointment.set('payment.status', 'refunded');
  }

  await appointment.save();
  // A cancellation takes someone out of the waiting line, so every board and
  // queue card watching that day is now showing a stale count.
  await broadcastQueue(appointment.doctorId, appointment.slotStart);
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
    // One patient in the room at a time. The queue, the board and "call next"
    // all assume it; a second consult started from the appointments table would
    // be hidden behind the first on every screen, and "call next" would refuse
    // until somebody found and finished the one nobody could see.
    const occupied = await AppointmentModel.exists({
      _id: { $ne: appointment._id },
      doctorId: appointment.doctorId,
      slotStart: { $gte: startOfDayUtc(appointment.slotStart), $lt: endOfDayUtc(appointment.slotStart) },
      status: 'in_progress',
    });
    if (occupied) throw ApiError.conflict('Finish with the patient you are seeing first.');

    appointment.status = 'in_progress';
    appointment.consultStartedAt ??= new Date();
    await appointment.save();

    await afterward('record the called token', () =>
      recordCalled(appointment.doctorId, appointment.slotStart, appointment.tokenNumber),
    );
    await broadcastQueue(appointment.doctorId, appointment.slotStart);
  }

  return present(appointment._id);
}

/**
 * Marks a patient as not having turned up.
 *
 * A separate ending from `cancelled`, and the difference is not cosmetic: the
 * slot is released either way, but a no-show says the clinic held the time and
 * nobody came, while a cancellation says the time was given back. The doctor's
 * day, the patient's history and any future policy about repeat no-shows all
 * need to tell those apart.
 *
 * No refund is attempted. Money taken for a slot the clinic kept open is a
 * decision for a person, not something to hand back automatically.
 */
export async function markNoShow(id: string, actor: Actor): Promise<AppointmentDto> {
  const appointment = await load(id);
  await assertMayAct(appointment, actor, { patientsAllowed: false });

  if (appointment.status === 'no_show') {
    throw ApiError.conflict('That appointment is already marked as a no-show.');
  }
  if (!OPEN_STATUSES.includes(appointment.status as AppointmentStatus)) {
    throw ApiError.conflict('A finished appointment cannot be marked as a no-show.');
  }

  appointment.status = 'no_show';
  await appointment.save();
  await broadcastQueue(appointment.doctorId, appointment.slotStart);

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
  // Recomputed from the last twenty finished consults, so the queue's estimate
  // is this doctor's real pace rather than a constant.
  await afterward('refresh the median consult length', () =>
    refreshMedianConsultMins(appointment.doctorId),
  );
  await afterward('count the patient served', () =>
    recordServed(appointment.doctorId, appointment.slotStart),
  );
  await broadcastQueue(appointment.doctorId, appointment.slotStart);

  return present(appointment._id);
}

/**
 * Runs a follow-on step after the appointment itself has been saved.
 *
 * The save is the thing the doctor asked for, and it has happened. If the step
 * after it fails — a blip on the median query, say — reporting the whole action
 * as an error would be a lie, and pressing the button again would then fail for
 * real with "already marked complete". So the failure is logged loudly and the
 * action still succeeds. Every one of these steps is repaired by the next
 * consult that runs it.
 */
async function afterward(what: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    logger.error(`Could not ${what} after saving an appointment`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Re-reads one appointment through the same shape every list returns. */
async function present(id: Types.ObjectId): Promise<AppointmentDto> {
  const [row] = await AppointmentModel.aggregate<AppointmentRow>([
    { $match: { _id: id } },
    ...patientLookupStages,
    ...triageLookupStages,
  ]);
  if (!row) throw ApiError.notFound('No appointment with that id.');
  return toAppointmentDto(row);
}

/* ------------------------------------------------------------- booking --- */

/** What booking needs. Every value is either from the token or re-derived. */
export interface BookingRequest {
  doctorId: string;
  /** The exact start of an offered slot. Checked, never trusted. */
  slotStart: Date;
  mode: PaymentMode;
  triageId?: string | undefined;
}

/**
 * Books a slot.
 *
 * Three things are deliberately *not* taken from the request. The fee comes
 * from the doctor record, so a client sending `amount: 1` changes nothing. The
 * token number is derived, so it cannot be chosen. And the slot is re-generated
 * from the doctor's hours and matched exactly, so a request naming 03:17 on a
 * Sunday is refused even though no appointment occupies it — "free" and
 * "offered" are different questions, and only checking the first would let
 * anyone book any instant they liked.
 *
 * The last word on a race belongs to the unique index, not to the availability
 * check above it. Two requests for one slot both pass that check; one insert
 * wins and the other comes back as a duplicate key, which becomes a clean 409.
 */
export async function bookAppointment(
  patientId: string,
  request: BookingRequest,
): Promise<AppointmentDto> {
  const doctor = await DoctorModel.findById(request.doctorId);
  if (!doctor) throw ApiError.notFound('No doctor with that id.');

  const account = await UserModel.findById(doctor.userId).select('name image isActive');
  // Same answer as the catalogue gives, so a removed doctor cannot be booked by
  // anyone who kept an old link.
  if (!account?.isActive) throw ApiError.notFound('No doctor with that id.');

  if (!doctor.available) {
    throw ApiError.conflict('That doctor is not taking bookings at the moment.');
  }

  const day = startOfDayUtc(request.slotStart);
  if (day >= horizonEnd()) {
    throw ApiError.conflict('That is further ahead than the clinic books.');
  }

  // The same generator the patient's grid was drawn from, asked whether this
  // exact instant is one of the times on it.
  const offered = isOfferedSlot(
    {
      workingHours: doctor.workingHours ?? [],
      slotDurationMins: doctor.slotDurationMins,
      date: request.slotStart,
    },
    request.slotStart,
  );
  if (!offered) {
    throw ApiError.conflict('That is not a time this doctor sees patients.');
  }

  const slotEnd = new Date(request.slotStart.getTime() + doctor.slotDurationMins * 60_000);

  // An assessment may only be attached by the person it is about. Without this
  // check an id alone would be enough to staple somebody else's symptoms to
  // your appointment — and the doctor would read them as yours before the
  // consult. Ownership, not just a well-formed id.
  if (request.triageId) {
    const assessment = await TriageAssessmentModel.findById(request.triageId).select('patientId');
    if (!assessment || String(assessment.patientId) !== patientId) {
      throw ApiError.notFound('That assessment could not be found.');
    }
  }

  try {
    const appointment = await AppointmentModel.create({
      patientId: new Types.ObjectId(patientId),
      doctorId: doctor._id,
      slotStart: request.slotStart,
      slotEnd,
      tokenNumber: tokenFor(doctor, request.slotStart),
      status: 'booked',
      // From the doctor record, never from the request body.
      amount: doctor.fees,
      payment: {
        mode: request.mode,
        // Cash is owed at the desk from the moment it is booked; a gateway
        // payment is owed to the gateway and stays pending until it clears.
        status: request.mode === 'cash' ? 'pending_at_desk' : 'pending',
      },
      ...(request.triageId ? { triageId: new Types.ObjectId(request.triageId) } : {}),
      docSnapshot: {
        name: account.name,
        speciality: doctor.speciality,
        fees: doctor.fees,
        ...(account.image ? { image: account.image } : {}),
      },
    });

    return await present(appointment._id);
  } catch (caught) {
    if (isDuplicateSlot(caught)) {
      throw ApiError.conflict('Someone just took that time. Pick another.');
    }
    throw caught;
  }
}

/**
 * The token a slot carries.
 *
 * Its position in the doctor's own day, not a running count of bookings. A
 * counter would need either a lock or a second unique index to survive two
 * people booking at once, and it would number patients by who clicked first —
 * which is not the order anybody is seen in. Position means token 1 is the
 * first appointment of the morning whoever booked it, the board reads in time
 * order, and no two concurrent bookings can be handed the same number.
 *
 * Numbers therefore have gaps when slots go unbooked, which is honest: token 7
 * is the seventh slot of the day, not the seventh patient.
 */
function tokenFor(doctor: DoctorDocument, slotStart: Date): number {
  const slots = slotsFor({
    workingHours: doctor.workingHours ?? [],
    slotDurationMins: doctor.slotDurationMins,
    date: slotStart,
    taken: [],
    // From the start of the day, so the token does not depend on the hour the
    // booking happened to be made — otherwise the same slot would number
    // differently in the morning than it does at noon.
    now: new Date(startOfDayUtc(slotStart).getTime() - 1),
  });

  const at = slots.findIndex((slot) => slot.start === slotStart.toISOString());
  return at + 1;
}

/**
 * Whether an error is the unique index refusing a second booking for one slot.
 *
 * Narrowed to that specific index by name. Any other duplicate key here is a
 * different bug and must not be reported to a patient as "someone took it".
 */
function isDuplicateSlot(caught: unknown): boolean {
  const error = caught as { code?: number; message?: string };
  return error?.code === 11000 && String(error.message).includes('one_active_appointment_per_slot');
}
