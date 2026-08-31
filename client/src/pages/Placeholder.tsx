import { Link } from 'react-router-dom';

/** Stands in for pages that arrive in later phases. */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="text-ink-muted">This arrives in a later phase.</p>
      <Link to="/" className="text-brand-600 hover:underline">
        Back to the home page
      </Link>
    </main>
  );
}
