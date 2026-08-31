import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../utils/apiError.js';

/**
 * Validates a request against a schema and **replaces** the request part with
 * the parsed result. Replacing rather than merely checking is the point: zod
 * strips keys the schema does not declare, so a client cannot smuggle extra
 * fields (`role: "admin"`, `fees: 0`) past a handler that spreads the body.
 */

type Part = 'body' | 'query' | 'params';

export function validate(schemas: Partial<Record<Part, ZodType>>): RequestHandler {
  return (req, _res, next) => {
    const details: Record<string, string> = {};

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (result.success) {
        // req.query and req.params are getter-only in Express 5, so the parsed
        // value is defined over them rather than assigned.
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
        continue;
      }

      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || part;
        details[key] ??= issue.message;
      }
    }

    if (Object.keys(details).length > 0) {
      next(ApiError.validation(details));
      return;
    }

    next();
  };
}
