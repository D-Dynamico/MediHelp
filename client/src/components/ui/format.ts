/**
 * How money and time are written, everywhere.
 *
 * Both are read in columns and both change in place, which is why the body sets
 * tabular figures globally — these two are the reason.
 */

export function money(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

/**
 * "Wed, 2 Sep, 10:30". Never a raw ISO string in front of a person.
 *
 * Rendered in **UTC**, deliberately and unchanged from the original. The whole
 * booking system treats a slot as wall-clock time in UTC — the doctor's working
 * hours are stored that way and the slot grid is generated from them — so
 * showing a slot in the reader's local zone would move every appointment by
 * their offset. The weekday is new: a date alone makes "is that this week?"
 * a subtraction.
 */
export function whenOf(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

/** Just the time, for a row that already says which day it is. */
export function timeOf(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}
