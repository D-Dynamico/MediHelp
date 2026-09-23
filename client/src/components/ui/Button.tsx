import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The one button.
 *
 * `as="link"` exists because the alternative is what the codebase used to do:
 * hand-copy the button's classes onto a `<Link>` and let the two drift. A thing
 * that navigates is still a link and a thing that acts is still a button — the
 * element is decided by `as`, the appearance by `variant`.
 *
 * `danger` is outlined rather than filled. A red filled button is reserved for
 * the confirm step inside a destructive dialog and for the emergency call, so
 * that a filled red button always means "this is the serious one".
 */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

// Pills, with a real disabled state for the primary. A primary faded to half
// opacity read as a rendering glitch, not as "not yet"; a pale teal with muted
// text reads as waiting for you.
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 ' +
    'disabled:bg-brand-100 disabled:text-brand-700/80 disabled:shadow-none',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-ink-faint hover:bg-surface-sunken ' +
    'disabled:opacity-50',
  quiet: 'text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-50',
  danger: 'border border-danger-solid/60 text-danger-solid hover:bg-danger-bg disabled:opacity-50',
  /** Only inside a destructive dialog, and on the emergency card. */
};

const DANGER_FILLED = 'bg-danger-solid text-white hover:brightness-95';

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-body',
};

interface Common {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fills a `danger` button. The confirm step of a dialog, and nothing else. */
  filled?: boolean;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Square, icon-only. Required to carry a label for anyone not looking at it. */
  iconOnly?: boolean;
  'aria-label'?: string;
  title?: string;
  className?: string;
}

type ButtonProps = Common & {
  as?: 'button';
  type?: 'button' | 'submit';
  onClick?: () => void;
};

type LinkProps = Common & {
  as: 'link';
  /** An in-app route. Exactly one of `to` or `href`. */
  to?: string;
  /** A `tel:` or other external target, where the router has no business. */
  href?: string;
};

function classesFor({
  variant = 'primary',
  size = 'md',
  filled,
  fullWidth,
  iconOnly,
  className = '',
}: Common): string {
  const look = filled && variant === 'danger' ? DANGER_FILLED : VARIANTS[variant];
  const box = iconOnly
    ? { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-12 w-12' }[size]
    : SIZES[size];

  return [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition',
    'active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0',
    look,
    box,
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Keeps the button's width while it works, so the layout does not jump. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

export function Button(props: ButtonProps | LinkProps) {
  const classes = classesFor(props);

  if (props.as === 'link') {
    const { to, href, children, ...rest } = props;
    if (href || !to) {
      return (
        <a href={href ?? '#'} className={classes} aria-label={rest['aria-label']}>
          {children}
        </a>
      );
    }
    return (
      <Link to={to} className={classes} aria-label={rest['aria-label']}>
        {children}
      </Link>
    );
  }

  const { type = 'button', onClick, children, loading, disabled } = props;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={props['aria-label']}
      title={props.title}
      className={classes}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

/** A button that is only an icon. The label is not optional. */
export function IconButton({
  label,
  children,
  ...rest
}: Omit<ButtonProps, 'children' | 'iconOnly' | 'aria-label'> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Button {...rest} iconOnly aria-label={label} title={label}>
      {children}
    </Button>
  );
}
