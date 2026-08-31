/**
 * Day boundaries.
 *
 * The whole system stores and reasons about slots in UTC — the seed writes them
 * that way and the clinic's working hours are wall-clock strings interpreted
 * against the same zone. Keeping "today" in UTC too means the dashboard's
 * today-count and the doctor's today-filter can never disagree about where the
 * day ends.
 */

/** Midnight UTC at the start of the day `date` falls in. */
export function startOfDayUtc(date = new Date()): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Midnight UTC at the start of the *next* day — an exclusive upper bound. */
export function endOfDayUtc(date = new Date()): Date {
  const end = startOfDayUtc(date);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/** Midnight UTC on the first of the month `date` falls in. */
export function startOfMonthUtc(date = new Date()): Date {
  const start = startOfDayUtc(date);
  start.setUTCDate(1);
  return start;
}

/** Age in whole years on a plain date, or undefined when no date of birth. */
export function ageFrom(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined;
  return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}
