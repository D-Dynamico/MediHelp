import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { getSettings } from '../../config/env.js';
import { ApiError } from '../../utils/apiError.js';
import * as authService from './auth.service.js';
import type { AuthResult, SessionContext } from './auth.service.js';

/**
 * The HTTP layer for auth: cookies in, cookies out, status codes. All the rules
 * live in the service.
 */

export const REFRESH_COOKIE = 'medihelp_refresh';

/**
 * The refresh cookie is scoped to `/api/auth`, so it is not attached to every
 * ordinary API request — only to the three endpoints that actually need it.
 *
 * `sameSite: 'strict'` is affordable because the client is served from the same
 * origin as the API (see docs/DEPLOYMENT.md). It also means no separate CSRF
 * token layer. `secure` is off in development so http://localhost works.
 */
function refreshCookieOptions(expires: Date): CookieOptions {
  const { isProduction } = getSettings();
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    path: '/api/auth',
    expires,
  };
}

function contextOf(req: Request): SessionContext {
  return { ip: req.ip, ua: req.get('user-agent') };
}

/** Sends the session: token in the body, refresh in an httpOnly cookie. */
function sendSession(res: Response, result: AuthResult, status = 200): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(result.refreshExpiresAt));
  res.status(status).json({ user: result.user, accessToken: result.accessToken });
}

export const register: RequestHandler = async (req, res) => {
  const result = await authService.register(req.body as never, contextOf(req));
  sendSession(res, result, 201);
};

export const login: RequestHandler = async (req, res) => {
  const result = await authService.login(req.body as never, contextOf(req));
  sendSession(res, result);
};

export const refresh: RequestHandler = async (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('Your session has expired. Sign in again.');

  try {
    sendSession(res, await authService.refresh(token, contextOf(req)));
  } catch (error) {
    // The cookie is no good; clear it so the browser stops sending it.
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw error;
  }
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  res.json({ user: await authService.currentUser(req.auth!.userId) });
};
