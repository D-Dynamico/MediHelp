import { useEffect, useState } from 'react';
import { SPECIALITIES } from '@shared/types';
import type { HealthResponse } from '@shared/types';

export function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Could not reach the API'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-brand-700">MediHelp</h1>
        <p className="text-ink-muted">
          Book an appointment with a doctor you trust. The scaffold is up; features arrive
          phase by phase.
        </p>
      </header>

      <section className="rounded-lg border border-brand-100 bg-surface p-4">
        <h2 className="text-sm font-medium">Specialities we cover</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {SPECIALITIES.map((speciality) => (
            <li
              key={speciality}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700"
            >
              {speciality}
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-sm">
        <span className="font-medium">API status: </span>
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : health ? (
          <span className="text-green-700">
            {health.status} · up {Math.round(health.uptime)}s
          </span>
        ) : (
          <span className="text-ink-muted">checking…</span>
        )}
      </footer>
    </main>
  );
}
