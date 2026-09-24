import type { RequestHandler } from 'express';
import { ApiError } from '../utils/apiError.js';

/**
 * Defence in depth under zod. It does the jobs of `express-mongo-sanitize` and
 * `hpp`, which can't be used as they are: both assign `req.query`, and that
 * property is getter-only in Express 5, so they either throw or quietly do
 * nothing.
 *
 * zod is still the real guard. Every route validates its input, and a schema
 * that expects a string turns an object like `{ "$ne": null }` away. This layer
 * catches whatever a looser schema might let through. That is also why
 * `sanitizeFilter` stays off in `config/db.ts`.
 */

/** Keys MongoDB would read as an operator (`$gt`) or a path (`profile.role`). */
function isUnsafeKey(key: string): boolean {
  return key.startsWith('$') || key.includes('.');
}

/**
 * Deeper than any body this API takes. The deepest real one, the doctor's
 * working hours, is three levels down.
 */
const MAX_DEPTH = 32;

/**
 * Removes unsafe keys, in place. The payment webhook's signature is checked
 * against `req.rawBody`, so editing the parsed copy can't break it.
 *
 * The depth is capped because the walk recurses. A 90 kB body of nested brackets
 * fits under the size limit and parses fine, but it would overflow the stack
 * here and come back as a 500 on any route, including login. Past the cap it's
 * a plain 400.
 */
function stripOperators(value: unknown, depth = 0): void {
  if (value === null || typeof value !== 'object') return;
  if (depth > MAX_DEPTH) throw ApiError.badRequest('That request is nested too deeply.');

  if (Array.isArray(value)) {
    for (const item of value) stripOperators(item, depth + 1);
    return;
  }

  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) delete (value as Record<string, unknown>)[key];
    else stripOperators((value as Record<string, unknown>)[key], depth + 1);
  }
}

/**
 * The body half on its own, for multipart forms. multer reads those inside the
 * route, after `sanitizeRequest` has already run and found no body, so the
 * upload chain runs this once the fields exist.
 */
export const sanitizeBody: RequestHandler = (req, _res, next) => {
  if (req.body !== undefined) stripOperators(req.body);
  next();
};

export const sanitizeRequest: RequestHandler = (req, _res, next) => {
  if (req.body !== undefined) stripOperators(req.body);

  // Express 5's "simple" query parser only gives strings and string arrays, so
  // operator objects can't arrive this way. A repeated key (`?page=1&page=2`)
  // does arrive as an array, though. As `hpp` does, the last value wins. No route
  // takes an array in its query; if one ever does, it must opt out here.
  //
  // `req.query` is re-parsed on every read, so the result is defined over it
  // rather than edited in place. It's the same pattern as `validate.ts`.
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (isUnsafeKey(key)) continue;
    query[key] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true });

  next();
};
