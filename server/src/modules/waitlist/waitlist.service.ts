import { Types } from 'mongoose';
import type { AppointmentDto, PaymentMode, WaitlistEntryDto } from '@shared/types.js';
import { ACTIVE_APPOINTMENT_STATUSES } from '@shared/types.js';
import { AppointmentModel, WaitlistModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { dayFromKey, endOfDayUtc, startOfDayUtc } from '../../utils/dates.js';
import { bookAppointment } from '../appointments/appointment.service.js';
import { slotsOn } from '../doctors/doctor.service.js';
import {
  ACTIVE_WAITLIST_STATES,
  notify,
  offerNext,
  sweepWaitlist,
  toWaitlistDto,
} from './waitlist.offers.js';

/**
 * A patient's side of the waitlist: joining, looking, leaving, and claiming.
 *
 * Every route here is the signed-in patient acting on their own entries. An entry
 * belonging to someone else answers 404 rather than 403, so the ids cannot be
 * probed.
 */

/** How long an offer that lapsed stays on the patient's screen as "expired". */
const RECENTLY_EXPIRED_MS = 60 * 60 * 1000;

/**
 * Puts a patient on a doctor's waitlist for one day.
 *
 * Only for a day that is genuinely full. If there is still a time free, the
 * right answer is to book it — a waitlist entry beside an open slot would sit
 * there never being offered anything, because nothing is going to be cancelled
 * into a day that still has room.
 */
export async function joinWaitlist(
  patientId: string,
  doctorId: string,
  dateKey: string,
): Promise<WaitlistEntryDto> {
  const day = dayFromKey(dateKey);
  if (day < startOfDayUtc()) {
    throw ApiError.conflict('That day has already gone.');
  }

  // `slotsOn` also answers 404 for a doctor who does not exist or was removed,
  // and returns an empty day for one not taking bookings or beyond the horizon.
  const slots = await slotsOn(doctorId, day);
  if (slots.length === 0) {
    throw ApiError.conflict('That doctor is not seeing patients that day.');
  }
  if (slots.some((slot) => slot.available)) {
    throw ApiError.conflict('There are still free times that day. Pick one of those instead.');
  }

  const doctor = new Types.ObjectId(doctorId);
  const patient = new Types.ObjectId(patientId);

  const booked = await AppointmentModel.exists({
    patientId: patient,
    doctorId: doctor,
    slotStart: { $gte: day, $lt: endOfDayUtc(day) },
    status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] },
  });
  if (booked) {
    throw ApiError.conflict('You already have an appointment with this doctor that day.');
  }

  // The back of the line. Two people joining in the same instant can both read
  // the same last position and be handed the same number; offers break that tie
  // by id, so the order is still total and nobody is skipped.
  const last = await WaitlistModel.findOne({ doctorId: doctor, date: day })
    .sort({ position: -1 })
    .select('position')
    .lean();

  try {
    const entry = await WaitlistModel.create({
      doctorId: doctor,
      patientId: patient,
      date: day,
      position: (last?.position ?? 0) + 1,
      state: 'waiting',
    });
    return await toWaitlistDto(entry);
  } catch (caught) {
    const error = caught as { code?: number; message?: string };
    if (error?.code === 11000 && String(error.message).includes('one_active_waitlist_entry')) {
      throw ApiError.conflict('You are already on the waitlist for that day.');
    }
    throw caught;
  }
}

/**
 * The patient's own entries worth showing: everything still active, plus any
 * offer that lapsed in the last hour so the screen can say what happened rather
 * than letting a card silently vanish.
 */
export async function listMine(patientId: string): Promise<WaitlistEntryDto[]> {
  const entries = await WaitlistModel.find({
    patientId: new Types.ObjectId(patientId),
    date: { $gte: startOfDayUtc() },
    $or: [
      { state: { $in: [...ACTIVE_WAITLIST_STATES] } },
      {
        state: 'expired',
        offerExpiresAt: { $gte: new Date(Date.now() - RECENTLY_EXPIRED_MS) },
      },
    ],
  }).sort({ date: 1, position: 1 });

  return Promise.all(entries.map((entry) => toWaitlistDto(entry)));
}

async function ownEntry(patientId: string, entryId: string) {
  const entry = await WaitlistModel.findById(entryId);
  if (!entry || String(entry.patientId) !== patientId) {
    throw ApiError.notFound('No waitlist entry with that id.');
  }
  return entry;
}

/**
 * Leaves the waitlist — or, on an open offer, lets the offered slot go.
 *
 * The same action either way, because it is the same decision: "I no longer
 * want a place that day". A slot being let go is passed straight to the next
 * person, not left held until the window would have closed; ten minutes of a
 * slot nobody wants is ten minutes someone else could have had it.
 */
export async function withdraw(patientId: string, entryId: string): Promise<WaitlistEntryDto> {
  const entry = await ownEntry(patientId, entryId);

  const wasOffered = entry.state === 'offered';
  const slot = entry.offeredSlot;

  const updated = await WaitlistModel.findOneAndUpdate(
    { _id: entry._id, state: { $in: [...ACTIVE_WAITLIST_STATES] } },
    { $set: { state: 'withdrawn' } },
    { returnDocument: 'after' },
  );
  if (!updated) throw ApiError.conflict('That waitlist entry is no longer active.');

  if (wasOffered && slot?.start && slot.end) {
    await offerNext(updated.doctorId, slot.start, slot.end);
  }

  return toWaitlistDto(updated);
}

/**
 * Takes an offered slot and turns it into a real appointment.
 *
 * The entry is marked claimed **before** the booking is made, by a conditional
 * update that only succeeds on an offer that is still open. That is the step
 * that settles a race with the sweeper: whichever of the two changes the state
 * first wins, and the other finds nothing to change. The clock is part of the
 * condition, so an offer is refused the moment it lapses even on a host that
 * slept through the sweeper's last run.
 *
 * The booking then goes through the ordinary booking path — the same fee from
 * the doctor record, the same token from the slot's position, the same unique
 * index. If that booking fails anyway, the patient did nothing wrong, so they
 * go back to waiting at the place they had rather than losing it.
 */
export async function claim(
  patientId: string,
  entryId: string,
  mode: PaymentMode,
): Promise<{ appointment: AppointmentDto; entry: WaitlistEntryDto }> {
  const entry = await ownEntry(patientId, entryId);

  if (entry.state !== 'offered') {
    throw ApiError.conflict('There is no open offer on that waitlist entry.');
  }

  const claimed = await WaitlistModel.findOneAndUpdate(
    { _id: entry._id, state: 'offered', offerExpiresAt: { $gt: new Date() } },
    { $set: { state: 'claimed' } },
    { returnDocument: 'after' },
  );

  if (!claimed) {
    // Lapsed between the page drawing the countdown and the button being
    // pressed. Run the sweep now rather than waiting for the minute to turn,
    // so the next person hears about the slot straight away.
    await sweepWaitlist();
    throw ApiError.conflict('That offer has lapsed, and the slot has moved on.');
  }

  const slot = claimed.offeredSlot!;
  try {
    const appointment = await bookAppointment(patientId, {
      doctorId: String(claimed.doctorId),
      slotStart: slot.start!,
      mode,
    });
    await notify(claimed);
    return { appointment, entry: await toWaitlistDto(claimed) };
  } catch (caught) {
    await WaitlistModel.updateOne(
      { _id: claimed._id, state: 'claimed' },
      { $set: { state: 'waiting' }, $unset: { offeredAt: 1, offerExpiresAt: 1, offeredSlot: 1 } },
    );
    throw caught;
  }
}
