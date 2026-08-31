import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types.js';
import { getSettings } from '../config/env.js';
import { ApiError } from './apiError.js';

/**
 * Two kinds of token, on purpose:
 *
 * - The **access token** is a short-lived signed JWT. It is readable by anyone
 *   holding it, so it carries only an id and a role, and it is never stored on
 *   the client outside memory.
 * - The **refresh token** is a long random string with no meaning of its own.
 *   Only its hash is stored, so the database cannot hand out sessions, and it is
 *   sent as an httpOnly cookie the page's JavaScript cannot read.
 */

export interface AccessTokenPayload {
  /** The user's id. */
  sub: string;
  role: Role;
}

/** Turns "15m" / "7d" into milliseconds. */
export function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Unsupported duration: ${duration}`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * factor;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const { JWT_SECRET, ACCESS_TOKEN_TTL } = getSettings();
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'medihelp',
  });
}

/**
 * Verifies an access token. Every failure — expired, tampered, wrong issuer —
 * becomes the same 401, because telling a caller *why* their token was rejected
 * only helps someone probing.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const { JWT_SECRET } = getSettings();
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: 'medihelp' });
    if (typeof decoded === 'string' || !decoded.sub || !('role' in decoded)) {
      throw new Error('malformed payload');
    }
    return { sub: String(decoded.sub), role: decoded.role as Role };
  } catch {
    throw ApiError.unauthorized('Your session has expired. Sign in again.');
  }
}

/** A new refresh token: the value to send, and the hash to store. */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

/**
 * SHA-256 rather than bcrypt: the token is already 32 bytes of randomness, so
 * there is nothing to brute force, and this is looked up on every refresh.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Groups every token descended from one login, so a theft can revoke them all. */
export function newTokenFamily(): string {
  return crypto.randomUUID();
}

export function refreshTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + durationToMs(getSettings().REFRESH_TOKEN_TTL));
}
