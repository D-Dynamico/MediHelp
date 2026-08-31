import { useEffect, useState } from 'react';

type Health = { status: string; uptime: number };

export function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Could not reach the API'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold text-brand-700">MediHelp</h1>
      <p className="text-ink-muted">
        Hospital management system. The scaffold is up; features arrive phase by phase.
      </p>
      <div className="rounded-lg border border-brand-100 bg-surface p-4">
        <span className="text-sm font-medium">API status: </span>
        {error ? (
          <span className="text-sm text-red-600">{error}</span>
        ) : health ? (
          <span className="text-sm text-green-700">
            {health.status} · up {Math.round(health.uptime)}s
          </span>
        ) : (
          <span className="text-sm text-ink-muted">checking…</span>
        )}
      </div>
    </main>
  );
}
