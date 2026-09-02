import { Button } from './Button';

/**
 * Previous, next, and where you are.
 *
 * No numbered buttons: with a filterable list they are a row of targets nobody
 * aims at, and "page 7" means nothing once the filter changes.
 */
export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-end gap-3">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <p className="text-sm text-ink-muted">
        Page {page} of {pages}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
