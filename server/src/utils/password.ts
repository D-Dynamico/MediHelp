import bcrypt from 'bcryptjs';

/**
 * Password hashing. bcryptjs rather than the native bcrypt: no compiler
 * toolchain needed, which keeps installs working on Windows and on Render's
 * build image alike.
 */

/** Work factor. 12 is the current sensible default: slow enough, not painful. */
const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
