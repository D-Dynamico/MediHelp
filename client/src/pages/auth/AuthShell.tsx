import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Radio, ShieldCheck } from 'lucide-react';
import { ErrorNote, Logo, LogoMark } from '../../components/ui';

/**
 * The frame around signing in and signing up.
 *
 * Split in two on a wide screen: the form on the right, and on the left a
 * brand panel saying what the account is for. A lone card on grey asked for a
 * password without a word about why; the panel is the why, in three lines. On
 * a phone the panel goes and the form is the whole screen — nobody reads a
 * brochure to log in on a phone.
 *
 * Server errors sit at the top of the form, where the eye returns after a
 * failed submit.
 */
export function AuthShell({
  title,
  description,
  error,
  children,
  footer,
}: {
  title: string;
  description: string;
  error: string | null;
  children: ReactNode;
  footer: { prompt: string; label: string; to: string };
}) {
  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Soft shapes, not a stock photo: a photograph of a smiling stranger in
            a white coat is the least trusted image on the internet. */}
        <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600 opacity-60" />
        <div aria-hidden className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-800 opacity-70" />

        <Link to="/" className="relative inline-flex items-center gap-2.5 self-start rounded-sm">
          <LogoMark size={32} inverted />
          <span className="text-h3 font-bold">MediHelp</span>
        </Link>

        <div className="relative max-w-md space-y-8">
          <h2 className="text-display font-bold">Less time in the waiting room.</h2>
          <ul className="space-y-5">
            <Point icon={ShieldCheck}>Book verified doctors in under a minute.</Point>
            <Point icon={Radio}>Watch your place in the queue from your phone.</Point>
            <Point icon={BellRing}>Get offered a cancelled slot on a full day.</Point>
          </ul>
        </div>

        <p className="relative text-sm text-white/70">
          In an emergency, call 112. MediHelp is for appointments, not urgent care.
        </p>
      </aside>

      <main className="flex flex-col justify-center px-4 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-10 inline-flex rounded-sm lg:hidden">
            <Logo />
          </Link>

          <div className="space-y-6">
            <header className="space-y-2">
              <h1 className="text-h1 font-bold text-ink sm:text-display">{title}</h1>
              <p className="text-body text-ink-muted">{description}</p>
            </header>

            {error && <ErrorNote message={error} />}

            {children}
          </div>

          <p className="mt-8 text-sm text-ink-muted">
            {footer.prompt}{' '}
            <Link to={footer.to} className="rounded-sm font-semibold text-brand-600 hover:text-brand-700">
              {footer.label}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function Point({ icon: Icon, children }: { icon: typeof ShieldCheck; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
        <Icon aria-hidden size={20} />
      </span>
      <span className="text-body text-white/90">{children}</span>
    </li>
  );
}
