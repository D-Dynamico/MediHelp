import type { Role, UserDto } from '@shared/types.js';
import { ApiError } from '../../utils/apiError.js';
import { logger } from '../../config/logger.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import {
  createRefreshToken,
  hashRefreshToken,
  newTokenFamily,
  refreshTokenExpiry,
  signAccessToken,
} from '../../utils/tokens.js';
import {
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  RefreshTokenModel,
  UserModel,
  type UserDocument,
} from '../../models/index.js';

/**
 * Everything about proving who someone is. No HTTP in here: the controller
 * turns these results into cookies and status codes.
 */

export interface SessionContext {
  ip?: string | undefined;
  ua?: string | undefined;
}

export interface AuthResult {
  user: UserDto;
  accessToken: string;
  /** Belongs in an httpOnly cookie. Never in a response body. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function toUserDto(user: UserDocument): UserDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.image ? { image: user.image } : {}),
  };
}

async function issueSession(
  user: UserDocument,
  family: string,
  context: SessionContext,
): Promise<AuthResult> {
  const { token, tokenHash } = createRefreshToken();
  const expiresAt = refreshTokenExpiry();

  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash,
    family,
    expiresAt,
    ip: context.ip,
    ua: context.ua,
  });

  return {
    user: toUserDto(user),
    accessToken: signAccessToken({ sub: String(user._id), role: user.role as Role }),
    refreshToken: token,
    refreshExpiresAt: expiresAt,
  };
}

/**
 * Self-registration. Patients only — doctors are created by an admin and admins
 * are seeded, so `role` is never read from the request.
 */
export async function register(
  input: { name: string; email: string; password: string; phone?: string; dob?: string },
  context: SessionContext,
): Promise<AuthResult> {
  const existing = await UserModel.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  const user = await UserModel.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: 'patient',
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.dob ? { dob: new Date(input.dob) } : {}),
  });

  return issueSession(user, newTokenFamily(), context);
}

/**
 * One failure message for every reason — wrong email, wrong password,
 * deactivated account — so the endpoint cannot be used to discover which emails
 * are registered.
 */
export async function login(
  input: { email: string; password: string },
  context: SessionContext,
): Promise<AuthResult> {
  const wrong = ApiError.unauthorized('That email and password do not match.');

  const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select(
    '+passwordHash',
  );
  if (!user) {
    // Spend roughly the time a real check would, so a missing account is not
    // detectable by how fast the answer comes back.
    await verifyPassword(input.password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw wrong;
  }

  if (user.isLocked()) {
    throw ApiError.tooManyRequests(
      'Too many failed attempts. Try again in a few minutes, or reset your password.',
    );
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    user.failedLogins += 1;
    if (user.failedLogins >= MAX_FAILED_LOGINS) {
      user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLogins = 0;
      logger.warn('Account locked after repeated failures', { userId: String(user._id) });
    }
    await user.save();
    throw wrong;
  }

  if (!user.isActive) throw wrong;

  if (user.failedLogins > 0 || user.lockUntil) {
    user.failedLogins = 0;
    user.lockUntil = undefined;
    await user.save();
  }

  return issueSession(user, newTokenFamily(), context);
}

/**
 * Rotation with reuse detection.
 *
 * Each refresh swaps the presented token for a new one in the same family. A
 * token that was already rotated should never be seen again — if it is, it was
 * captured, so the whole family is revoked and everyone holding one is signed
 * out. That turns a stolen token into a single failed request rather than a
 * quiet parallel session.
 */
export async function refresh(
  presentedToken: string,
  context: SessionContext,
): Promise<AuthResult> {
  const expired = ApiError.unauthorized('Your session has expired. Sign in again.');

  const stored = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(presentedToken) });
  if (!stored) throw expired;

  if (stored.revokedAt) {
    await RefreshTokenModel.updateMany(
      { family: stored.family, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
    logger.warn('Refresh token reuse detected; family revoked', {
      userId: String(stored.userId),
      family: stored.family,
    });
    throw expired;
  }

  if (stored.expiresAt.getTime() <= Date.now()) throw expired;

  const user = await UserModel.findById(stored.userId);
  if (!user || !user.isActive) throw expired;

  const next = await issueSession(user, stored.family, context);

  stored.revokedAt = new Date();
  stored.replacedBy = hashRefreshToken(next.refreshToken);
  await stored.save();

  return next;
}

/** Signs out the presented session only, leaving other devices alone. */
export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;
  await RefreshTokenModel.updateOne(
    { tokenHash: hashRefreshToken(presentedToken), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

/** Signs out every device. Used when a password changes or a theft is suspected. */
export async function logoutEverywhere(userId: string): Promise<void> {
  await RefreshTokenModel.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

export async function currentUser(userId: string): Promise<UserDto> {
  const user = await UserModel.findById(userId);
  if (!user || !user.isActive) throw ApiError.unauthorized();
  return toUserDto(user);
}
