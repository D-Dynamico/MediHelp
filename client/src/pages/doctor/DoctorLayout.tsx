import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * The shell every doctor screen sits in.
 *
 * Deliberately the same shape as the admin shell rather than a second layout
 * idea: two dashboards in one app that navigate differently is a thing a user
 * has to learn twice. Three sections instead of four, because a doctor manages
 * their own day, not the clinic.
 */

const SECTIONS = [
  { to: '/doctor', label: 'Today', end: true },
  { to: '/doctor/appointments', label: 'Appointments', end: false },
  { to: '/doctor/profile', label: 'Profile', end: false },
];

export function DoctorLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onSignOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="border-b border-brand-100 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold text-brand-700">MediHelp</span>
            <span className="text-xs uppercase tracking-wide text-ink-muted">Doctor</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink-muted sm:inline">{user?.name}</span>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-surface-sunken"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6 md:flex-row">
        <nav className="flex gap-2 overflow-x-auto md:w-48 md:flex-col md:overflow-visible">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-surface'
                }`
              }
            >
              {section.label}
            </NavLink>
          ))}
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
