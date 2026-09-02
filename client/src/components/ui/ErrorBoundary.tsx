import { Component, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * The last resort for a route group.
 *
 * Without one, a render error blanks the screen and leaves a patient looking at
 * white. This gives them the same shape as the 404: what happened, and one
 * button back to somewhere that works.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; home: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <Placeholder
        title="Something went wrong"
        message="That screen could not be shown. Reloading usually fixes it."
        action={{ label: 'Reload', onClick: () => window.location.reload() }}
        secondary={{ label: 'Go back', to: this.props.home }}
      />
    );
  }
}

/**
 * 404, 403, offline and the error boundary all share this.
 *
 * Every one of them is a dead end unless it offers a way out, so the action is
 * not optional.
 */
export function Placeholder({
  title,
  message,
  action,
  secondary,
}: {
  title: string;
  message: string;
  action: { label: string; to: string } | { label: string; onClick: () => void };
  secondary?: { label: string; to: string };
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-h1 font-semibold text-ink">{title}</h1>
      <p className="max-w-prose text-body text-ink-muted">{message}</p>

      <div className="flex flex-wrap gap-2">
        {'to' in action ? (
          <Button as="link" to={action.to}>
            {action.label}
          </Button>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        )}
        {secondary && (
          <Button as="link" to={secondary.to} variant="quiet">
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}
