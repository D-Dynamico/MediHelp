import { z } from 'zod';

/**
 * What each auth endpoint accepts. Anything not declared here is stripped by
 * `validate()` before a handler ever sees it.
 */

const email = z
  .email('Enter a valid email address.')
  .max(200)
  .transform((value) => value.trim().toLowerCase());

/**
 * Length over character classes: a long passphrase beats a short one with a
 * symbol bolted on, and rules that demand symbols mostly produce "Password1!".
 */
const password = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(200, 'That is too long.');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email,
  password,
  phone: z.string().trim().max(20).optional(),
  dob: z.iso.date('Enter a valid date.').optional(),
});

export const loginSchema = z.object({
  email,
  // Not the strict `password` rule: an old account may predate today's minimum,
  // and rejecting it here would say "your password is too short" to someone
  // simply typing the wrong one.
  password: z.string().min(1, 'Enter your password.').max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
