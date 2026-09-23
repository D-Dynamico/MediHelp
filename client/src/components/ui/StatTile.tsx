import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';

/**
 * One number.
 *
 * The value is the largest thing on it. The icon is small and tinted, there to
 * let an eye find "revenue" among four tiles without reading every label — not
 * to decorate. Still no trend arrows or sparklines: four tiles competing for
 * attention tell you less than four that each say one thing.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon aria-hidden size={18} />
          </span>
        )}
      </div>
      <p className="mt-2 text-display font-bold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}
