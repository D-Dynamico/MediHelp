import type { LucideIcon } from 'lucide-react';
import { LogOut } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Avatar, ErrorBoundary, IconButton, Logo } from './ui';

/**
 * The shell both work areas sit in.
 *
 * The doctor and admin shells were two copies of one idea that had already
 * started to drift. Two dashboards in one app that navigate differently is
 * something a person has to learn twice, so there is one shell and a list of
 * sections.
 *
 * On desktop it is a full-height sidebar pinned to the left edge — logo at the
 * top, sections, and the signed-in person at the foot — with the page beside
 * it. It used to sit inside a centred container under a separate header, which
 * left the sidebar floating mid-screen on a wide monitor and the header and the
 * content lining up with nothing. On mobile it becomes a slim top bar and a
 * bottom tab bar; a scrolling strip hides its last item off-screen, which is
 * exactly where "Profile" used to end up.
 */

export interface Section {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export function WorkShell({
  role,
  sections,
  home,
}: {
  role: string;
  sections: Section[];
  home: string;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onSignOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-sunken">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface md:flex">
        <Link to={home} className="flex h-16 items-center rounded-sm px-5">
          <Logo tag={role} />
        </Link>

        <nav aria-label={`${role} sections`} className="flex-1 space-y-1 px-3 py-4">
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                `flex h-11 items-center gap-3 rounded-full px-4 text-sm font-semibold transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`
              }
            >
              <section.icon aria-hidden size={19} />
              {section.label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="flex items-center gap-3 border-t border-line p-4">
            <Avatar name={user.name} size="sm" {...(user.image ? { src: user.image } : {})} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
              <p className="truncate text-xs text-ink-muted">{user.email}</p>
            </div>
            <IconButton label="Sign out" variant="quiet" size="sm" onClick={() => void onSignOut()}>
              <LogOut aria-hidden size={17} />
            </IconButton>
          </div>
        )}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur md:hidden">
        <Link to={home} className="rounded-sm">
          <Logo tag={role} />
        </Link>
        <IconButton label="Sign out" variant="quiet" size="sm" onClick={() => void onSignOut()}>
          <LogOut aria-hidden size={17} />
        </IconButton>
      </header>

      {/* Padded at the bottom on mobile so the tab bar never covers the last
          row of a table. */}
      <main className="min-w-0 px-4 pb-24 pt-6 sm:px-6 md:ml-64 md:px-10 md:pb-12 md:pt-10">
        <div className="mx-auto max-w-6xl">
          <ErrorBoundary home={home}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      <nav
        aria-label={`${role} sections`}
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-float backdrop-blur md:hidden"
      >
        {sections.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold ${
                isActive ? 'text-brand-600' : 'text-ink-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition ${
                    isActive ? 'bg-brand-50' : ''
                  }`}
                >
                  <section.icon aria-hidden size={19} />
                </span>
                {section.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
