import { Card } from './Card';

/**
 * One number.
 *
 * The value is the only large thing on it — no icon, no trend arrow, no
 * sparkline. A dashboard of four tiles competing for attention tells you less
 * than four tiles that each say one thing.
 */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-h1 font-semibold text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </Card>
  );
}
