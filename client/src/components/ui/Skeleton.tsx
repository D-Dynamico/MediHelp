import { Card } from './Card';

/**
 * Placeholders shaped like the thing that is coming.
 *
 * A spinner tells you to wait; a skeleton tells you what you are waiting for,
 * and the page does not jump when it arrives. `Loading` survives for the small
 * inline cases — a button, a slot grid refetching under an unchanged heading.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton animate-shimmer rounded-sm ${className}`} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={`h-4 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <Card>
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <SkeletonText lines={2} />
      </div>
    </Card>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <Card padding="sm">
      <div className="space-y-3" role="status" aria-label="Loading">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

/** Inline only. Whole screens use a skeleton. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-6 text-sm text-ink-muted">
      {label}
    </p>
  );
}
