import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Phone, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { homeFor } from '../../routes/guards';
import { Avatar, Button, ErrorBoundary, IconButton, Logo } from '../../components/ui';

/**
 * The shell around everything a patient sees, signed in or not.
 *
 * Unlike the admin and doctor shells this one has to work for a stranger: the
 * catalogue is the clinic's front door and most people meet it before they have
 * an account. So the nav shows Sign in until there is someone to greet, and
 * never hides the browse links behind the login.
 *
 * Below `md` the links move into a sheet. They used to wrap onto a second line
 * and squeeze the wordmark; a sheet keeps the header one fixed height and gives
 * each link a 48px target, which is what a thumb needs.
 */

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

const PATIENT_LINKS: NavItem[] = [
  { to: '/triage', label: 'Check symptoms' },
  { to: '/my/appointments', label: 'My appointments' },
];

export function SiteLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // A sheet that survives navigation would cover the page it just opened.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  async function onSignOut() {
    await logout();
    navigate('/', { replace: true });
  }

  const links: NavItem[] = [
    { to: '/', label: 'Find a doctor', end: true },
    ...(user?.role === 'patient' ? PATIENT_LINKS : []),
    ...(user && user.role !== 'patient'
      ? [{ to: homeFor(user.role), label: 'Dashboard' }]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-surface-sunken">
      {/* Sticky and translucent, so the way home and the account are always one
          tap away on a long doctor list without a solid bar eating the page. */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="rounded-sm" aria-label="MediHelp home">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <HeaderLink key={link.to} to={link.to} end={link.end}>
                {link.label}
              </HeaderLink>
            ))}

            {user ? (
              <div className="ml-3 flex items-center gap-2 border-l border-line pl-4">
                {user.role === 'patient' && (
                  <Link to="/account" className="rounded-full" aria-label="Account">
                    <Avatar
                      name={user.name}
                      size="sm"
                      {...(user.image ? { src: user.image } : {})}
                    />
                  </Link>
                )}
                <Button variant="quiet" size="sm" onClick={() => void onSignOut()}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="ml-3 flex items-center gap-2">
                <Button as="link" to="/login" variant="quiet" size="sm">
                  Sign in
                </Button>
                <Button as="link" to="/signup" size="sm">
                  Create account
                </Button>
              </div>
            )}
          </nav>

          <div className="md:hidden">
            <IconButton
              label={menuOpen ? 'Close menu' : 'Open menu'}
              variant="quiet"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X aria-hidden size={20} /> : <Menu aria-hidden size={20} />}
            </IconButton>
          </div>
        </div>

        {menuOpen && (
          <div className="border-t border-line bg-surface md:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col px-4 py-2">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    `flex h-12 items-center rounded-full px-4 text-body font-semibold ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-ink'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}

              {user ? (
                <>
                  {user.role === 'patient' && (
                    <NavLink
                      to="/account"
                      className="flex h-12 items-center rounded-sm px-3 text-body font-medium text-ink"
                    >
                      Account
                    </NavLink>
                  )}
                  <button
                    type="button"
                    onClick={() => void onSignOut()}
                    className="flex h-12 items-center rounded-sm px-3 text-left text-body font-medium text-ink-muted"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <NavLink
                  to="/login"
                  className="flex h-12 items-center rounded-sm px-3 text-body font-medium text-brand-500"
                >
                  Sign in
                </NavLink>
              )}
            </nav>
          </div>
        )}
      </header>

      {/* Inside the shell, not around it: a screen that throws should still
          leave the reader a header they can navigate out of. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <ErrorBoundary home="/">
          <Outlet />
        </ErrorBoundary>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The foot of every public page.
 *
 * Its one job that matters is the emergency line. A health site that only ever
 * says "book an appointment" will eventually be read by someone who should not
 * be booking anything, and the place people look for "what if it is serious"
 * is the bottom of the page.
 */
function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="space-y-2">
          <Logo />
          <p className="max-w-sm text-sm text-ink-muted">
            Book a doctor in under a minute, see your place in the queue live, and get offered
            cancelled slots automatically.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-md bg-danger-bg px-4 py-3">
          <Phone aria-hidden size={18} className="shrink-0 text-danger-solid" />
          <p className="text-sm text-danger-fg">
            <span className="font-semibold">In an emergency, do not book.</span> Call{' '}
            <a href="tel:112" className="font-semibold underline underline-offset-2">
              112
            </a>{' '}
            or go to the nearest emergency department.
          </p>
        </div>
      </div>
    </footer>
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
        `rounded-full px-4 py-2 text-sm font-semibold transition ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
