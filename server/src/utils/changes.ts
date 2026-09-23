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
  // `image` is the stored name. People reading the trail think of it as the photo.
  return docs.flatMap((doc) => doc.directModifiedPaths()).map((path) => (path === 'image' ? 'photo' : path));
}

/** The before and after of the fee, which is money and so worth more than a field name. */
export function feeChange(before: number | undefined, after: number | undefined) {
  return before === after ? {} : { fees: { from: before, to: after } };
}
