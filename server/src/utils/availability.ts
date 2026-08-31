import type { WorkingHoursDto } from '@shared/types.js';

/**
 * Checking that a set of working hours makes sense.
 *
 * Slot generation (phase 6) walks each window from `start` to `end` in
 * slot-sized steps. It has no way to tell a genuine overnight shift from a
 * typo, and two windows that overlap would produce the same slot twice — which
 * then races against the unique index and turns into a booking failure the
 * patient sees. Both are much cheaper to refuse here.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "HH:mm" as minutes past midnight. */
export function minutesOf(time: string): number {
  const [hours, mins] = time.split(':');
  return Number(hours) * 60 + Number(mins);
}

/** The shortest window worth having: one appointment at the smallest length. */
const MIN_WINDOW_MINUTES = 5;

export interface AvailabilityProblem {
  /** Index into the submitted array, so a form can mark the row. */
  index: number;
  message: string;
}

/**
 * Every problem with a set of working hours, not just the first.
 *
 * All of them at once, because a doctor filling in a week's grid wants to fix
 * their whole Tuesday in one pass rather than resubmit five times.
 */
export function findAvailabilityProblems(
  windows: readonly WorkingHoursDto[],
): AvailabilityProblem[] {
  const problems: AvailabilityProblem[] = [];

  windows.forEach((window, index) => {
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);

    if (end <= start) {
      problems.push({
        index,
        message: `${DAY_NAMES[window.day] ?? 'That day'} ends at or before it starts.`,
      });
      return;
    }

    if (end - start < MIN_WINDOW_MINUTES) {
      problems.push({ index, message: 'That sitting is too short to hold an appointment.' });
    }
  });

  // Overlaps, day by day. Sorting by start makes this one pass per day: once the
  // windows are in order, an overlap can only be with the one immediately before.
  const byDay = new Map<number, { index: number; start: number; end: number }[]>();
  windows.forEach((window, index) => {
    const list = byDay.get(window.day) ?? [];
    list.push({ index, start: minutesOf(window.start), end: minutesOf(window.end) });
    byDay.set(window.day, list);
  });

  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1]!;
      const current = sorted[i]!;
      // Touching is fine — 09:00–13:00 then 13:00–17:00 is one long day, not a
      // clash. Only a genuine overlap is a problem.
      if (current.start < previous.end) {
        problems.push({
          index: current.index,
          message: `${DAY_NAMES[day] ?? 'That day'} has two sittings that overlap.`,
        });
      }
    }
  }

  return problems;
}
