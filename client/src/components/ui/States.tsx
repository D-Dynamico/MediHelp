import type { ReactNode } from 'react';
import { Inbox, TriangleAlert } from 'lucide-react';
import { Card } from './Card';
import { Button } from './Button';

/**
 * The three things a data screen shows when it has no data to show.
 *
 * Both of these take an action, and `Empty` requires one. A dead end is the
 * failure mode: "No appointments yet" with nothing to press leaves the reader
 * to work out for themselves that the answer is on another screen.
 */

export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  /** Where to go next. Required on purpose. */
  action: { label: string; to: string } | { label: string; onClick: () => void };
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-3 py-4">
        <Inbox aria-hidden size={20} className="text-ink-faint" />
        <p className="max-w-prose text-body text-ink-muted">{children}</p>
        {'to' in action ? (
          <Button as="link" to={action.to} variant="secondary" size="sm">
            {action.label}
          </Button>
        ) : (
          <Button onClick={action.onClick} variant="secondary" size="sm">
            {action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card tone="danger" padding="sm">
      <div className="flex flex-wrap items-center gap-3">
        <TriangleAlert aria-hidden size={20} className="text-danger-solid" />
        <p className="flex-1 text-sm text-danger-fg">{message}</p>
        {onRetry && (
          <Button onClick={onRetry} variant="secondary" size="sm">
            Try again
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * The async triad in one place, so pages stop branching by hand and stop
 * disagreeing about the order of the branches.
 */
export function AsyncState<T>({
  data,
  error,
  skeleton,
  empty,
  onRetry,
  children,
}: {
  /** `null` means "not here yet"; an empty array means "here, and empty". */
  data: T | null;
  error: string | null;
  skeleton: ReactNode;
  empty: ReactNode;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (error && data === null) {
    return <ErrorNote message={error} {...(onRetry ? { onRetry } : {})} />;
  }
  if (data === null) return <>{skeleton}</>;
  if (Array.isArray(data) && data.length === 0) return <>{empty}</>;
  return <>{children(data)}</>;
}
