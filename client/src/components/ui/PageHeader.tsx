import type { ReactNode } from 'react';

/**
 * The top of every screen.
 *
 * One `h1` naming what the screen is for in plain words, one sentence under it,
 * and at most one action. Ten screens wrote this by hand and drifted; the
 * single-sentence rule is load-bearing — if a screen needs two, the screen is
 * doing too much.
 */
export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-8 space-y-2">
      {breadcrumb && <div className="text-sm text-ink-muted">{breadcrumb}</div>}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-h1 font-bold text-ink lg:text-display">{title}</h1>
        {action}
      </div>

      {description && <p className="max-w-prose text-body text-ink-muted">{description}</p>}
    </header>
  );
}
