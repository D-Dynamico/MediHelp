import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fieldErrorsFrom, messageFrom } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';

export function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(field: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
      // Clear the field's error as soon as it is touched, so the form does not
      // keep scolding about something being fixed.
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        ...(form.phone ? { phone: form.phone } : {}),
      });
      navigate('/', { replace: true });
    } catch (caught) {
      const details = fieldErrorsFrom(caught);
      setFieldErrors(details);
      // Only show the banner when nothing landed on a specific field, so the
      // same problem is not reported twice.
      if (Object.keys(details).length === 0) {
        setError(messageFrom(caught, 'Could not create your account.'));
      }
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-100';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-brand-100 bg-surface p-6 shadow-sm"
        noValidate
      >
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-ink">Create an account</h1>
          <p className="text-sm text-ink-muted">It takes a moment.</p>
        </header>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {(
          [
            { id: 'name', label: 'Full name', type: 'text', autoComplete: 'name' },
            { id: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
            { id: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
            { id: 'phone', label: 'Phone (optional)', type: 'tel', autoComplete: 'tel' },
          ] as const
        ).map((field) => (
          <div key={field.id} className="space-y-1">
            <label htmlFor={field.id} className="block text-sm font-medium">
              {field.label}
            </label>
            <input
              id={field.id}
              type={field.type}
              autoComplete={field.autoComplete}
              value={form[field.id]}
              onChange={update(field.id)}
              aria-invalid={Boolean(fieldErrors[field.id])}
              aria-describedby={fieldErrors[field.id] ? `${field.id}-error` : undefined}
              className={`${inputClass} ${
                fieldErrors[field.id] ? 'border-red-400' : 'border-slate-300 focus:border-brand-500'
              }`}
            />
            {fieldErrors[field.id] && (
              <p id={`${field.id}-error`} className="text-sm text-red-600">
                {fieldErrors[field.id]}
              </p>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-500 px-4 py-2 font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
