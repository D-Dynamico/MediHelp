/**
 * The mark and the wordmark.
 *
 * A soft-cornered teal square with a cross, and a small bright dot in the
 * corner: the cross says what the place is, the dot is the "live" in the live
 * queue. Drawn inline rather than loaded, so it is sharp at any size and never
 * a missing image in the header.
 */
export function LogoMark({
  size = 28,
  inverted = false,
}: {
  size?: number;
  /** White square, teal cross — for a teal background, where the usual mark vanishes. */
  inverted?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="9" fill={inverted ? '#fff' : 'var(--brand-600)'} />
      <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill={inverted ? 'var(--brand-600)' : '#fff'} />
      <circle cx="23.5" cy="23.5" r="3.5" fill="#5eead4" />
    </svg>
  );
}

export function Logo({ tag }: { /** A quiet label after the name, like "Doctor". */ tag?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-h3 font-bold tracking-tight text-ink">MediHelp</span>
      {tag && (
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {tag}
        </span>
      )}
    </span>
  );
}
