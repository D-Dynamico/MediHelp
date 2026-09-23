import { Types } from 'mongoose';
import type { WaitlistEntryDto } from '@shared/types.js';
import { ACTIVE_APPOINTMENT_STATUSES, WAITLIST_UPDATE_EVENT } from '@shared/types.js';
import { AppointmentModel, OFFER_WINDOW_MS, WaitlistModel } from '../../models/index.js';
import type { WaitlistDocument } from '../../models/index.js';
import { logger } from '../../config/logger.js';
import { dayKeyUtc, startOfDayUtc } from '../../utils/dates.js';
import { emitToUser } from '../../realtime/io.js';

/**
 * Offering freed slots to the people waiting for them.
 *
 * Kept apart from `waitlist.service.ts` for the same reason the queue's
 * broadcast is: the appointment service has to call `offerNext` when anything is
 * cancelled, and the waitlist service has to call the appointment service to
 * book a claimed slot. With both in one file the two services would import each
 * other. This module reads and writes models and emits; it calls no service.
 */

/** States in which an entry still has a claim on the doctor's day. */
export const ACTIVE_WAITLIST_STATES = ['waiting', 'offered'] as const;

/**
 * Slots currently held for somebody on the waitlist.
 *
 * While an offer is open the slot is theirs: the catalogue shows it as taken and
 * a walk-in booking is refused. Without the hold, "you have ten minutes to claim
 * this" would be a race the person being offered it cannot see, against anyone
 * browsing the doctor's page — and they would lose it to whoever happened to
 * refresh first.
 *
 * An offer past its expiry holds nothing, whether or not the sweeper has run.
 */
export async function heldSlots(doctorId: Types.ObjectId | string, day: Date): Promise<Date[]> {
  const rows = await WaitlistModel.find({
    doctorId: new Types.ObjectId(String(doctorId)),
    date: startOfDayUtc(day),
    state: 'offered',
    offerExpiresAt: { $gt: new Date() },
  })
    .select('offeredSlot')
    .lean();

  return rows.flatMap((row) => (row.offeredSlot?.start ? [row.offeredSlot.start] : []));
}

/** Whether one exact slot is under an open offer. */
export async function isHeld(doctorId: Types.ObjectId | string, slotStart: Date): Promise<boolean> {
  const held = await heldSlots(doctorId, slotStart);
  return held.some((start) => start.getTime() === slotStart.getTime());
}

/**
 * Offers a freed slot to the first person waiting for that doctor's day.
 *
 * Called on every cancellation, when an offer lapses, and when someone lets an
 * offer go — which is how one freed slot walks down the list until somebody
 * takes it or the list runs out. When it runs out the slot simply stops being
 * held, and it is back in the open catalogue with nothing further to do.
 *
 * Returns the entry that was offered the slot, or null when nobody was.
 *
 * The pick-and-mark is a single `findOneAndUpdate` with a sort, so two
 * cancellations landing together cannot offer both slots to the same person or
 * one slot to two people: each update claims a different `waiting` document or
 * finds none.
 */
export async function offerNext(
  doctorId: Types.ObjectId | string,
  slotStart: Date,
  slotEnd: Date,
): Promise<WaitlistDocument | null> {
  const id = new Types.ObjectId(String(doctorId));
  const now = new Date();

  // A slot that has already begun is not worth offering: nobody can be told,
  // travel, and arrive for a consult that started without them.
  if (slotStart <= now) return null;

  // Somebody may have booked it in the moment between the cancellation and
  // this call. Offering a taken slot would hand a person a claim that can only
  // fail.
  const taken = await AppointmentModel.exists({
    doctorId: id,
    slotStart,
    status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] },
  });
  if (taken || (await isHeld(id, slotStart))) return null;

  // Never past the start of the slot itself. A ten-minute window on a slot that
  // starts in six would let someone claim a consult already under way.
  const expiresAt = new Date(Math.min(now.getTime() + OFFER_WINDOW_MS, slotStart.getTime()));

  const entry = await WaitlistModel.findOneAndUpdate(
    { doctorId: id, date: startOfDayUtc(slotStart), state: 'waiting' },
    {
      $set: {
        state: 'offered',
        offeredAt: now,
        offerExpiresAt: expiresAt,
        offeredSlot: { start: slotStart, end: slotEnd },
      },
    },
    // Position first; the id breaks a tie, because two people joining at the
    // same instant can be handed the same position and one of them still has
    // to be first.
    { sort: { position: 1, _id: 1 }, returnDocument: 'after' },
  );

  if (!entry) return null;

  // There is no SMS or email provider yet, so the log line is the record that
  // an offer went out — and the only place to see one in the sandbox without a
  // browser open as that patient.
  logger.info('Waitlist offer sent', {
    entryId: String(entry._id),
    patientId: String(entry.patientId),
    slotStart: slotStart.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  await notify(entry);
  return entry;
}

/**
 * Lapses offers whose window has closed, and passes each slot on.
 *
 * The sweeper's whole job, kept here so a check script can call it with a clock
 * of its choosing instead of waiting a real minute. Each lapse is a conditional
 * update, so an offer claimed in the same instant is not expired underneath the
 * person who claimed it.
 *
 * Also retires entries for days that are over. Nobody is waiting for yesterday.
 */
export async function sweepWaitlist(now = new Date()): Promise<{ expired: number; offered: number }> {
  let expired = 0;
  let offered = 0;

  const lapsed = await WaitlistModel.find({
    state: 'offered',
    offerExpiresAt: { $lte: now },
  }).select('_id');

  for (const { _id } of lapsed) {
    const entry = await WaitlistModel.findOneAndUpdate(
      { _id, state: 'offered', offerExpiresAt: { $lte: now } },
      { $set: { state: 'expired' } },
      { returnDocument: 'after' },
    );
    if (!entry) continue;
    expired += 1;
    await notify(entry);

    const slot = entry.offeredSlot;
    if (slot?.start && slot.end && (await offerNext(entry.doctorId, slot.start, slot.end))) {
      offered += 1;
    }
  }

  const stale = await WaitlistModel.updateMany(
    { state: 'waiting', date: { $lt: startOfDayUtc(now) } },
    { $set: { state: 'expired' } },
  );
  expired += stale.modifiedCount;

  return { expired, offered };
}

/** How many active entries sit ahead of this one in its doctor's day. */
export async function aheadOf(entry: WaitlistDocument): Promise<number> {
  if (entry.state !== 'waiting') return 0;
  return WaitlistModel.countDocuments({
    doctorId: entry.doctorId,
    date: entry.date,
    state: 'waiting',
    $or: [
      { position: { $lt: entry.position } },
      { position: entry.position, _id: { $lt: entry._id } },
    ],
  });
}

/** The entry as its patient sees it. */
export async function toWaitlistDto(entry: WaitlistDocument): Promise<WaitlistEntryDto> {
  const populated = await entry.populate<{
    doctorId: {
      _id: Types.ObjectId;
      speciality: WaitlistEntryDto['doctor']['speciality'];
      userId: { name: string; image?: string } | null;
    };
  }>({ path: 'doctorId', select: 'speciality userId', populate: { path: 'userId', select: 'name image' } });

  const doctor = populated.doctorId;
  const slot = entry.offeredSlot;
  const offerOpen = entry.state === 'offered' && slot?.start && slot.end && entry.offerExpiresAt;

  return {
    id: String(entry._id),
    doctor: {
      id: String(doctor._id),
      name: doctor.userId?.name ?? 'Doctor',
      speciality: doctor.speciality,
      ...(doctor.userId?.image ? { image: doctor.userId.image } : {}),
    },
    date: dayKeyUtc(entry.date),
    state: entry.state,
    ahead: await aheadOf(entry),
    ...(offerOpen
      ? {
          offer: {
            slotStart: slot.start!.toISOString(),
            slotEnd: slot.end!.toISOString(),
            expiresAt: entry.offerExpiresAt!.toISOString(),
          },
        }
      : {}),
  };
}

/**
 * Tells the patient their entry changed. Never throws: the state change already
 * happened, and a page load shows it even if the push did not arrive.
 */
export async function notify(entry: WaitlistDocument): Promise<void> {
  try {
    // Re-read so the populate in `toWaitlistDto` does not rewrite the caller's
    // document: its `doctorId` must stay an id for the cascade that follows.
    const fresh = await WaitlistModel.findById(entry._id);
    if (fresh) emitToUser(String(entry.patientId), WAITLIST_UPDATE_EVENT, await toWaitlistDto(fresh));
  } catch (error) {
    logger.warn('Could not push a waitlist update', {
      entryId: String(entry._id),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
