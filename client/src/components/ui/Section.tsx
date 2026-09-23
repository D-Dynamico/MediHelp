import type { ReactNode } from 'react';

/**
 * A titled part of a page: a heading, an optional line under it, an optional
 * action on the right, and whatever it holds.
 *
 * This is what a table or a list with a heading sits in. It used to be a `Card`
 * with an `h2` inside, which put a table's own card inside another one — two
 * borders, two paddings, and the heading floating in a box of its own.
 */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-h2 font-semibold text-ink">{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
