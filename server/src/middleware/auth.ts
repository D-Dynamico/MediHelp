import type { Request, RequestHandler } from 'express';
import type { Role } from '@shared/types.js';
import { ApiError } from '../utils/apiError.js';
import { verifyAccessToken } from '../utils/tokens.js';
import { AuditLogModel } from '../models/index.js';
import { logger } from '../config/logger.js';

/**
 * The guards. Three separate questions, deliberately not collapsed into one:
 *
 *   requireAuth       — who are you?
 *   requireRole       — are you the kind of user allowed here?
 *   requireOwnership  — is this particular thing yours?
 *
 * The third is the one that gets forgotten. A doctor holding a valid token and
 * the right role can still try to complete another doctor's appointment by
 * changing an id in the URL; only an ownership check stops that.
 */

/** Reads `Authorization: Bearer <token>` and attaches the verified identity. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(ApiError.unauthorized());
    return;
  }

  const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
  req.auth = { userId: payload.sub, role: payload.role };
  next();
};

/** Restricts a route to one or more roles. Must run after `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

/**
 * Confirms the signed-in user owns the resource. `loadOwnerId` returns the id of
 * whoever the resource belongs to; an admin passes regardless, since managing
 * everyone's data is their job.
 *
 * A missing resource answers 404 rather than 403, so the check cannot be used to
 * probe which ids exist.
 */
export function requireOwnership(
  loadOwnerId: (req: Request) => Promise<string | null>,
): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) {
      next(ApiError.unauthorized());
      return;
    }
    if (req.auth.role === 'admin') {
      next();
      return;
    }

    const ownerId = await loadOwnerId(req);
    if (ownerId === null) {
      next(ApiError.notFound());
      return;
    }
    if (ownerId !== req.auth.userId) {
      logger.warn('Ownership check refused a request', {
        userId: req.auth.userId,
        path: req.originalUrl,
      });
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}

/**
 * Records a state-changing action. Deliberately never throws: a failed audit
 * write must not fail the operation the user asked for, but it must be visible
 * in the logs.
 */
export async function audit(
  req: Request,
  action: string,
  target: { type: string; id?: string },
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!req.auth) return;
  try {
    await AuditLogModel.create({
      actorId: req.auth.userId,
      actorRole: req.auth.role,
      action,
      targetType: target.type,
      ...(target.id ? { targetId: target.id } : {}),
      ...(meta ? { meta } : {}),
      ip: req.ip,
    });
  } catch (error) {
    logger.error('Failed to write an audit entry', {
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
