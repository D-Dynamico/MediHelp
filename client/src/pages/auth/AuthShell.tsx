import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorNote } from '../../components/ui';

/**
 * The frame around signing in and signing up.
 *
 * A reading surface, so `max-w-xl` and centred. The two screens were separate
 * copies of the same card; they differ in their fields, not in their shape.
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
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12 sm:px-6">
      <Link to="/" className="mb-6 rounded-sm text-h3 font-semibold text-ink">
        MediHelp
      </Link>

      <Card padding="lg">
        <div className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-h1 font-semibold text-ink">{title}</h1>
            <p className="text-body text-ink-muted">{description}</p>
          </header>

          {error && <ErrorNote message={error} />}

          {children}
        </div>
      </Card>

      <p className="mt-4 text-center text-sm text-ink-muted">
        {footer.prompt}{' '}
        <Link to={footer.to} className="rounded-sm font-medium text-brand-500">
          {footer.label}
        </Link>
      </p>
    </main>
  );
}
