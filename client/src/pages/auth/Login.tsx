import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { messageFrom } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { homeFor } from '../../routes/guards';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(email, password);
      // Back where they were headed, or the home page for their role.
      navigate(from ?? homeFor(user.role), { replace: true });
    } catch (caught) {
      setError(messageFrom(caught, 'Could not sign in. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-brand-100 bg-surface p-6 shadow-sm"
        noValidate
      >
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-ink">Sign in</h1>
          <p className="text-sm text-ink-muted">Book appointments and track your visits.</p>
        </header>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-500 px-4 py-2 font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-center text-sm text-ink-muted">
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand-600 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
