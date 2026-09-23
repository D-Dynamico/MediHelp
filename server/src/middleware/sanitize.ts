import type { RequestHandler } from 'express';

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
 * Removes unsafe keys at any depth, in place. The payment webhook's signature is
 * checked against `req.rawBody`, so editing the parsed copy can't break it.
 */
function stripOperators(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripOperators(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const key of Object.keys(value)) {
    if (isUnsafeKey(key)) delete (value as Record<string, unknown>)[key];
    else stripOperators((value as Record<string, unknown>)[key]);
  }
}

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
