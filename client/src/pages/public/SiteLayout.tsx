import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { homeFor } from '../../routes/guards';

/**
 * The shell around everything a patient sees, signed in or not.
 *
 * Unlike the admin and doctor shells this one has to work for a stranger: the
 * catalogue is the clinic's front door and most people meet it before they have
 * an account. So the nav shows Sign in until there is someone to greet, and
 * never hides the browse links behind the login.
 */
export function SiteLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onSignOut() {
    await logout();
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-sunken">
      <header className="border-b border-brand-100 bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <Link to="/" className="text-lg font-semibold text-brand-700">
            MediHelp
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <HeaderLink to="/" end>
              Find a doctor
            </HeaderLink>

            {user?.role === 'patient' && (
              <>
                <HeaderLink to="/my/appointments">My appointments</HeaderLink>
                <HeaderLink to="/account">Account</HeaderLink>
              </>
            )}

            {/* Staff signed in on the public side get a way back to their own
                dashboard rather than a patient nav that would only 403. */}
            {user && user.role !== 'patient' && (
              <HeaderLink to={homeFor(user.role)}>Dashboard</HeaderLink>
            )}

            {user ? (
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="ml-2 rounded-md border border-slate-300 px-3 py-1.5 font-medium transition hover:bg-surface-sunken"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/login"
                className="ml-2 rounded-md bg-brand-500 px-3 py-1.5 font-medium text-white transition hover:bg-brand-600"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function HeaderLink({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-3 py-1.5 font-medium transition ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-surface-sunken'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
