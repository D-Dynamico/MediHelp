import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ApiErrorBody } from '@shared/types';

/**
 * The one axios instance the app uses.
 *
 * The access token is held **in this module's memory**, never in localStorage.
 * A token in localStorage is readable by any script that gets onto the page,
 * which is the whole reason XSS turns into stolen sessions. Losing it on refresh
 * is fine: the httpOnly refresh cookie quietly gets a new one on load.
 */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export const api = axios.create({
  baseURL: '/api',
  // Same origin in both environments, but the refresh cookie still has to be
  // sent explicitly on the requests that need it.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/**
 * One refresh at a time.
 *
 * When a page makes five requests at once and the token has expired, all five
 * come back 401 together. Refreshing five times would rotate the token five
 * times, and the server treats a replayed refresh token as theft — it would
 * revoke the family and sign the user out. So the first 401 starts a refresh and
 * the rest wait on that same promise.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= api
    .post<{ accessToken: string }>('/auth/refresh')
    .then((response) => {
      setAccessToken(response.data.accessToken);
      return response.data.accessToken;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * Endpoints that must never trigger a refresh-and-retry. Refreshing because a
 * refresh failed is an infinite loop, and a failed login is a wrong password,
 * not an expired session.
 *
 * Note this is a list, not `startsWith('/auth/')`: `/auth/me` is an ordinary
 * protected endpoint and must be retried like any other.
 */
const NO_RETRY = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout'];

/** Called when refreshing fails, so the app can send the user to sign in. */
let onSessionLost: () => void = () => undefined;
export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;
    const noRetry = NO_RETRY.some((path) => config?.url?.startsWith(path));

    // Retry at most once.
    if (error.response?.status === 401 && config && !config._retried && !noRetry) {
      config._retried = true;
      try {
        const token = await refreshAccessToken();
        config.headers.Authorization = `Bearer ${token}`;
        return await api.request(config);
      } catch {
        setAccessToken(null);
        onSessionLost();
      }
    }

    return Promise.reject(error);
  },
);

/** Pulls the message out of an API error, with a fallback for network failures. */
export function messageFrom(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.error?.message ?? fallback;
  }
  return fallback;
}

/** Per-field messages from a 422, for showing errors next to inputs. */
export function fieldErrorsFrom(error: unknown): Record<string, string> {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.error?.details ?? {};
  }
  return {};
}
