import type { ApiErrorBody } from '@shared/types.js';

/**
 * An error the client is allowed to see. Anything thrown that is not an
 * ApiError is treated as a bug: logged in full, reported as a bare 500.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string> | undefined;
  /** True when the message is safe to show a user. */
  readonly expose = true;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  static badRequest(message: string, details?: Record<string, string>): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'You need to sign in to do that.'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have access to that.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  /** Someone else got there first — a taken slot, a duplicate email. */
  static conflict(message: string, details?: Record<string, string>): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }

  static validation(details: Record<string, string>): ApiError {
    return new ApiError(422, 'validation_failed', 'Some fields need fixing.', details);
  }

  static tooManyRequests(message = 'Too many attempts. Try again shortly.'): ApiError {
    return new ApiError(429, 'too_many_requests', message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
