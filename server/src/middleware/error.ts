import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MongoServerError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../utils/apiError.js';
import { logger } from '../config/logger.js';
import { getSettings } from '../config/env.js';
import { storage } from '../providers/storage/index.js';

/** Anything that reaches here matched no route. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`No route for ${req.method} ${req.originalUrl}`));
};

/** Turns a Mongoose validation error into per-field messages. */
function fromMongooseValidation(error: MongooseError.ValidationError): ApiError {
  const details: Record<string, string> = {};
  for (const [field, issue] of Object.entries(error.errors)) {
    details[field] = issue.message;
  }
  return ApiError.validation(details);
}

/**
 * A duplicate key means a uniqueness rule the database enforces was hit. These
 * are expected — two people booking one slot, a taken email — so they become a
 * 409 with a message that names what clashed, not a 500.
 */
function fromDuplicateKey(error: MongoServerError): ApiError {
  const field = Object.keys((error.keyPattern ?? {}) as Record<string, unknown>).join(', ');

  if (error.message.includes('one_active_appointment_per_slot')) {
    return ApiError.conflict('That time was just booked by someone else. Pick another slot.');
  }
  if (field.includes('email')) {
    return ApiError.conflict('An account with that email already exists.');
  }
  return ApiError.conflict('That already exists.', field ? { field } : undefined);
}

/** A malformed ObjectId in a URL is a bad request, not a server fault. */
function fromCastError(error: MongooseError.CastError): ApiError {
  return ApiError.badRequest(`"${String(error.value)}" is not a valid ${error.path}.`);
}

/**
 * `express.json()` rejects unreadable bodies with its own error carrying a
 * `type` and a 4xx `status`. Those are the client's fault, not ours, so they
 * must not fall through to the 500 branch.
 */
function fromBodyParser(error: unknown): ApiError | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & { status?: number; statusCode?: number; type?: string };
  const status = candidate.status ?? candidate.statusCode;
  if (!candidate.type || !status || status < 400 || status >= 500) return null;

  switch (candidate.type) {
    case 'entity.parse.failed':
      return ApiError.badRequest('The request body was not valid JSON.');
    case 'entity.too.large':
      return new ApiError(413, 'payload_too_large', 'That request was too large.');
    default:
      return ApiError.badRequest('The request could not be read.');
  }
}

function normalise(error: unknown): ApiError | null {
  if (isApiError(error)) return error;
  const bodyParserError = fromBodyParser(error);
  if (bodyParserError) return bodyParserError;
  if (error instanceof ZodError) {
    const details: Record<string, string> = {};
    for (const issue of error.issues) {
      details[issue.path.join('.') || '(body)'] = issue.message;
    }
    return ApiError.validation(details);
  }
  if (error instanceof MongooseError.ValidationError) return fromMongooseValidation(error);
  if (error instanceof MongooseError.CastError) return fromCastError(error);
  if (error instanceof MongoServerError && error.code === 11000) return fromDuplicateKey(error);
  return null;
}

/**
 * The single place an error becomes a response. Known errors keep their message;
 * anything else is a bug, so it is logged in full and reported as a bare 500 —
 * internals never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // The upload middleware stores the file before the handler runs, so a request
  // that fails afterwards — a taken email, a rejected field, an aborted
  // transaction — would leave the image behind with nothing pointing at it.
  // This is the one place every one of those paths passes through.
  if (req.uploadedImage) {
    const { key } = req.uploadedImage;
    delete req.uploadedImage;
    void storage().remove(key);
  }

  const known = normalise(error);

  if (known) {
    if (known.status >= 500) {
      logger.error(known.message, { path: req.originalUrl, code: known.code });
    } else {
      logger.debug(`${known.status} ${known.code}`, { path: req.originalUrl });
    }
    res.status(known.status).json(known.toBody());
    return;
  }

  logger.error('Unhandled error', {
    path: req.originalUrl,
    method: req.method,
    error: error instanceof Error ? error.stack : String(error),
  });

  const body = {
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our end.',
      ...(getSettings().isProduction
        ? {}
        : { details: { dev: error instanceof Error ? error.message : String(error) } }),
    },
  };
  res.status(500).json(body);
};
