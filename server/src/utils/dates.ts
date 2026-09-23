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

/**
 * The day as "YYYY-MM-DD" in UTC. Re-exported from `shared/queue.ts`, which the
 * client also builds socket room names from — two copies of this would name two
 * different rooms the first time either was touched.
 */
export { dayKeyUtc } from '@shared/queue.js';

/**
 * Midnight UTC for a "YYYY-MM-DD" key. Throws on anything else.
 *
 * Including keys that look right and name no real day. `new Date` rolls
 * 2026-02-31 over into 3 March without complaint, which would put a socket in a
 * room named for February while its snapshot said March — and every later
 * broadcast would go to the March room it is not in. Round-tripping the result
 * back to a key is what catches that.
 */
export function dayFromKey(key: string): Date {
  if (!isDayKey(key)) throw new Error(`Not a day key: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}

/** Whether a string is a "YYYY-MM-DD" key for a day that exists. */
export function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const day = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === key;
}
