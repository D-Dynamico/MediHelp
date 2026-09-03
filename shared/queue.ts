/**
 * The queue's arithmetic, shared by both sides.
 *
 * The server needs it to reason about a doctor's day; the patient's card needs
 * it to turn the snapshot it just received into "about 25 minutes". Two copies
 * of this would disagree the first time either was tuned, and the disagreement
 * would show up as the app telling one person two different waits on two
 * screens. Kept free of imports, like `types.ts`, so either runtime can load it.
 */

/**
 * The day as "YYYY-MM-DD" in UTC.
 *
 * This string is half of a socket room name, so the two sides have to build it
 * identically. An ISO timestamp is already UTC, so slicing it is both the
 * shortest way to get this and the only one that cannot pick up the reader's
 * offset — a client in Kolkata using local getters would name tomorrow's room
 * after 18:30 and hear nothing at all.
 */
export function dayKeyUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** A doctor's consult length when nothing has been learned from them yet. */
export const DEFAULT_CONSULT_MINS = 15;

/**
 * Where a token sits in the waiting line, or -1 if it is not waiting.
 *
 * `waiting` is the snapshot's list, already in the order people will be called,
 * so this is a lookup rather than a comparison — which is what keeps the client
 * from having to know how the order was decided.
 */
export function positionOf(waiting: readonly number[], token: number): number {
  return waiting.indexOf(token);
}

/**
 * The wait, in whole minutes, for somebody with `peopleAhead` in front of them.
 *
 * Rounded to the nearest five, and never presented as an exact figure. A queue
 * estimate is a forecast built on one number, and "about 25 minutes" is honest
 * in a way "23 minutes" is not — the false precision would be read as a promise
 * and remembered as a lie when the consult before ran long.
 *
 * Zero ahead means the next one in, which is deliberately 0 rather than one
 * consult: the person at the front is waiting for a door to open, not for
 * another appointment to happen.
 */
export function etaMinutes(peopleAhead: number, medianConsultMins: number): number {
  if (peopleAhead <= 0) return 0;
  const mins = peopleAhead * (medianConsultMins > 0 ? medianConsultMins : DEFAULT_CONSULT_MINS);
  return Math.max(5, Math.round(mins / 5) * 5);
}

/** The same wait as a phrase, for a screen. */
export function etaText(peopleAhead: number, medianConsultMins: number): string {
  const mins = etaMinutes(peopleAhead, medianConsultMins);
  if (mins === 0) return 'You are next';
  if (mins < 60) return `About ${mins} min`;

  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  const hourText = hours === 1 ? '1 hour' : `${hours} hours`;
  return rest === 0 ? `About ${hourText}` : `About ${hourText} ${rest} min`;
}
