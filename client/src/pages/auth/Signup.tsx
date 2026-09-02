import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldErrorsFrom, messageFrom } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { Button, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

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

  return (
    <AuthShell
      title="Create an account"
      description="It takes a moment. You need one to book, and to see your appointments."
      error={error}
      footer={{ prompt: 'Already have an account?', label: 'Sign in', to: '/login' }}
    >
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-6" noValidate>
        {(
          [
            { id: 'name', label: 'Full name', type: 'text', autoComplete: 'name' },
            { id: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
            { id: 'password', label: 'Password', type: 'password', autoComplete: 'new-password' },
            { id: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', optional: true },
          ] as const
        ).map((field) => (
          <Field
            key={field.id}
            label={field.label}
            optional={'optional' in field ? field.optional : false}
            {...(fieldErrors[field.id] ? { error: fieldErrors[field.id] } : {})}
          >
            {(props) => (
              <Input
                {...props}
                type={field.type}
                autoComplete={field.autoComplete}
                value={form[field.id]}
                onChange={update(field.id)}
                error={Boolean(fieldErrors[field.id])}
              />
            )}
          </Field>
        ))}

        <Button type="submit" loading={busy} fullWidth>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
