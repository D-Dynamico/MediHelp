import type { SlotDto, WorkingHoursDto } from '@shared/types.js';
import { minutesOf } from './availability.js';
import { startOfDayUtc } from './dates.js';

/**
 * Turning a doctor's working hours into the times a patient can actually pick.
 *
 * A pure function over plain values, deliberately. It is the same code that
 * builds the grid the patient sees *and* the code booking re-checks a request
 * against — if those two ever disagreed, a client could post any instant it
 * liked and get a consult at 03:17 on a Sunday. One function means they cannot
 * disagree.
 *
 * Everything here is UTC, like the rest of the system: `workingHours` are
 * wall-clock strings for the clinic, and `dates.ts` reasons about days in UTC
 * so that "today" means one thing everywhere.
 */

/**
 * How far ahead the clinic takes bookings.
 *
 * Some limit is needed — without one a diary fills with appointments made two
 * years out that nobody will keep, and every one of them holds a slot the unique
 * index will defend. Two months is long enough for a follow-up and short enough
 * that the doctor's hours are still roughly the hours they will work.
 */
export const BOOKING_HORIZON_DAYS = 60;

export interface SlotInputs {
  /** Every sitting the doctor keeps, across the whole week. */
  workingHours: readonly WorkingHoursDto[];
  slotDurationMins: number;
  /** The day being asked about. Only its UTC calendar date is used. */
  date: Date;
  /** Slot starts already taken by a non-cancelled appointment. */
  taken: readonly Date[];
  /** Injected rather than read, so the same inputs always give the same answer. */
  now?: Date;
}

/**
 * The slots on one day, in order, each marked bookable or not.
 *
 * Taken slots are returned rather than dropped: a patient looking at a day with
 * two free times out of twelve should see a busy day, not a suspiciously short
 * list. Past slots *are* dropped — they are not a choice, and showing this
 * morning greyed out all afternoon is noise.
 */
export function slotsFor({
  workingHours,
  slotDurationMins,
  date,
  taken,
  now = new Date(),
}: SlotInputs): SlotDto[] {
  const dayStart = startOfDayUtc(date);
  const weekday = dayStart.getUTCDay();

  // Compared as instants, so a slot that has already begun is gone even if the
  // day it belongs to has not ended.
  const takenAt = new Set(taken.map((slot) => slot.getTime()));

  const slots: SlotDto[] = [];

  for (const window of workingHours) {
    if (window.day !== weekday) continue;

    const opens = minutesOf(window.start);
    const closes = minutesOf(window.end);

    // Whole slots only. A sitting ending at 13:00 with 20 minutes left over
    // cannot hold a 30-minute consult, and offering one would book a patient
    // into the doctor's lunch.
    for (let at = opens; at + slotDurationMins <= closes; at += slotDurationMins) {
      const start = new Date(dayStart.getTime() + at * 60_000);
      if (start.getTime() <= now.getTime()) continue;

      const end = new Date(start.getTime() + slotDurationMins * 60_000);
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        available: !takenAt.has(start.getTime()),
      });
    }
  }

  // Sittings are stored in whatever order the doctor entered them, and a day can
  // hold several. The patient reads one list, in time order.
  return slots.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Whether an instant is a slot this doctor actually offers on that day.
 *
 * The question booking asks. It is not enough that the slot is free — a slot
 * nobody offers is free too, and without this a request could name any instant
 * at all and the unique index would happily accept it as a first booking.
 */
export function isOfferedSlot(
  inputs: Omit<SlotInputs, 'taken'> & { taken?: readonly Date[] },
  slotStart: Date,
): boolean {
  return slotsFor({ ...inputs, taken: inputs.taken ?? [] }).some(
    (slot) => slot.start === slotStart.toISOString(),
  );
}

/** The last day the clinic will take a booking for. */
export function horizonEnd(now = new Date()): Date {
  const end = startOfDayUtc(now);
  end.setUTCDate(end.getUTCDate() + BOOKING_HORIZON_DAYS);
  return end;
}
