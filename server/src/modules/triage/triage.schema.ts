import { z } from 'zod';

/**
 * What a patient may ask triage about.
 *
 * Free text, because the whole point is that they describe it in their own
 * words rather than picking from a list somebody else wrote. The floor is there
 * because two characters cannot be assessed and an empty box is a mis-click;
 * the ceiling matches the model's `maxlength` and keeps a pasted essay from
 * becoming a prompt we pay for.
 */
export const assessSchema = z.object({
  symptomsText: z
    .string()
    .trim()
    .min(10, 'Tell us a little more about what is wrong.')
    .max(4000, 'That is longer than we can read — please summarise.'),
  /**
   * How long it has been going on, if the patient answered separately. The
   * engine reads a duration out of the free text too; this just wins when given.
   */
  durationText: z.string().trim().max(80).optional(),
});

export type AssessInput = z.infer<typeof assessSchema>;

export const triageIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{24}$/i, 'That is not a valid id.'),
});
