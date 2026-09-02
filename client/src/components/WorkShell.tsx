import type { LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Avatar, Button, ErrorBoundary } from './ui';

/**
 * The shell both work areas sit in.
 *
 * The doctor and admin shells were two copies of one idea that had already
 * started to drift. Two dashboards in one app that navigate differently is
 * something a person has to learn twice, so there is now one shell and a list
 * of sections.
 *
 * On desktop it is a 240px sidebar. On mobile it becomes a bottom tab bar
 * rather than the horizontal scrolling strip it used to be — a strip hides its
 * last item off-screen, which is exactly where "Profile" ended up.
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
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-baseline gap-3">
            <span className="text-h3 font-semibold text-ink">MediHelp</span>
            <span className="text-xs text-ink-faint">{role}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.name}</span>
            {user && <Avatar name={user.name} size="sm" />}
            <Button variant="quiet" size="sm" onClick={() => void onSignOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <nav
          aria-label={`${role} sections`}
          className="hidden w-60 shrink-0 border-r border-line bg-surface-sunken p-3 md:block"
        >
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                `mb-1 flex h-10 items-center gap-3 rounded-sm px-3 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-500' : 'text-ink-muted hover:text-ink'
                }`
              }
            >
              <section.icon aria-hidden size={20} />
              {section.label}
            </NavLink>
          ))}
        </nav>

        {/* Padded at the bottom on mobile so the tab bar never covers the last
            row of a table. */}
        <main className="min-w-0 flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-8">
          <ErrorBoundary home={home}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <nav
        aria-label={`${role} sections`}
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-line bg-surface shadow-float md:hidden"
      >
        {sections.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                isActive ? 'text-brand-500' : 'text-ink-muted'
              }`
            }
          >
            <section.icon aria-hidden size={20} />
            {section.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
