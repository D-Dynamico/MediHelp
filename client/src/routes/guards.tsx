import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '@shared/types';
import { useAuth } from '../hooks/useAuth';

/**
 * Route guards. These are a convenience, not a security boundary — the server
 * decides what anyone may actually do. Their job is to keep people from landing
 * on a page that would only show them errors.
 */

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-ink-muted">
      Loading…
    </div>
  );
}

/** Requires anyone signed in. Remembers where they were headed. */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Requires one of the given roles. Sends anyone else to their own home page. */
export function RoleRoute({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

/** Keeps a signed-in user off the login and signup pages. */
export function GuestOnlyRoute() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

export function homeFor(role: Role): string {
  if (role === 'admin') return '/admin';
  if (role === 'doctor') return '/doctor';
  return '/';
}
