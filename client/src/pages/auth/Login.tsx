import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { messageFrom } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { homeFor } from '../../routes/guards';
import { Button, Field, Input } from '../../components/ui';
import { AuthShell } from './AuthShell';

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
    <AuthShell
      title="Sign in"
      description="Book appointments and track your visits."
      error={error}
      footer={{ prompt: 'New here?', label: 'Create an account', to: '/signup' }}
    >
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-6" noValidate>
        <Field label="Email">
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field label="Password">
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        <Button type="submit" loading={busy} fullWidth>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
