/**
 * A person.
 *
 * Was hand-rolled in three places with three sets of sizes. The fallback is the
 * first letter rather than a generic silhouette: in a list of patients the
 * letter is worth something and the silhouette is not.
 */

const SIZES = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-body',
  lg: 'h-16 w-16 text-h2',
  xl: 'h-24 w-24 text-h1',
};

export function Avatar({
  src,
  name,
  size = 'md',
}: {
  src?: string;
  name: string;
  size?: keyof typeof SIZES;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`${SIZES[size]} shrink-0 rounded-full border border-line object-cover`}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={`${SIZES[size]} flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700`}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}
