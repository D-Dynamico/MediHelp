import type { Document } from 'mongoose';

/**
 * What an edit actually changed, for the audit trail.
 *
 * The profile forms always send every field, so the list of fields in the
 * request says nothing. Mongoose already knows better: it marks a path modified
 * only when the new value really differs, including in objects and arrays. Read
 * this before `save()`, which clears those marks.
 */
export function changedFields(...docs: Document[]): string[] {
  const fields = docs.flatMap((doc) => doc.directModifiedPaths()).map(readableName);
  return [...new Set(fields)];
}

/**
 * `image` is the stored name, but people reading the trail think of it as the
 * photo. The address is written one line at a time, and it reads as one field.
 */
function readableName(path: string): string {
  if (path === 'image') return 'photo';
  if (path.startsWith('address.')) return 'address';
  return path;
}

/** The before and after of the fee, which is money and so worth more than a field name. */
export function feeChange(before: number | undefined, after: number | undefined) {
  return before === after ? {} : { fees: { from: before, to: after } };
}
