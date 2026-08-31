import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { getSettings } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Rate limiting, which is a different job from the per-account lockout in the
 * auth service:
 *
 * - the **lockout** protects one account from having its password guessed;
 * - the **limiter** protects the server from one source hammering it, including
 *   someone spraying one common password across many different accounts, which
 *   no per-account counter would ever notice.
 *
 * Both are needed. Neither replaces the other.
 */

/** Refused requests go through the normal error handler, so the shape matches. */
function refuse(): never {
  throw ApiError.tooManyRequests();
}

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Behind Render's proxy the socket address is the proxy's, so the forwarded
  // address is what identifies a caller. `trust proxy` is set in production for
  // exactly this reason; without it every visitor would share one bucket.
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  handler: refuse,
  // Skip in tests so the checks are not throttled by each other.
  skip: () => getSettings().NODE_ENV === 'test',
};

/**
 * Sign-in attempts. Deliberately tight, and counted per IP rather than per
 * account so that credential stuffing across many accounts is caught too.
 */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

/**
 * Registration. Tighter still: a real person signs up once, so anything beyond
 * a handful an hour from one address is a script making accounts.
 */
export const registerLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 60 * 1000,
  limit: 5,
});

/** A loose ceiling for everything else, so no single caller can flood the API. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
});
