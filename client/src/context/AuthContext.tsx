import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserDto } from '@shared/types';
import { api, setAccessToken, setSessionLostHandler } from '../api/client';

/**
 * Who is signed in, for the whole app.
 *
 * `loading` starts true: on a fresh page load there is no access token yet, but
 * there may be a valid refresh cookie. Until that has been tried, we do not know
 * whether the user is signed in — and routing before we know would bounce a
 * signed-in user to the login page on every refresh.
 */

export interface AuthContextValue {
  user: UserDto | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<UserDto>;
  register: (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<UserDto>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface SessionResponse {
  user: UserDto;
  accessToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A failed refresh anywhere in the app clears the user here.
  useEffect(() => {
    setSessionLostHandler(() => {
      if (mounted.current) setUser(null);
    });
  }, []);

  // Silent sign-in on load: swap the refresh cookie for a token, if it is valid.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const { data } = await api.post<SessionResponse>('/auth/refresh');
        if (cancelled) return;
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        // No cookie, or it has expired. Not an error: just not signed in.
        if (!cancelled) setAccessToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<SessionResponse>('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: { name: string; email: string; password: string; phone?: string }) => {
      const { data } = await api.post<SessionResponse>('/auth/register', input);
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Sign out locally even if the request failed — the user asked to leave.
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
