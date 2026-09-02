import type { ReactNode } from 'react';

/**
 * A panel.
 *
 * Cards have a hairline border and no shadow: shadows are for things that
 * float, and a page of shadowed boxes reads as clutter. `tone` replaces the
 * `className="border-danger-solid/20 bg-danger-bg"` overrides callers used to pass, so a
 * warning panel looks the same everywhere it appears.
 */

export type Tone = 'default' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  default: 'border-line bg-surface',
  info: 'border-info-solid/20 bg-info-bg',
  success: 'border-success-solid/20 bg-success-bg',
  warning: 'border-warning-solid/20 bg-warning-bg',
  danger: 'border-danger-solid/20 bg-danger-bg',
};

const PADDING = { sm: 'p-4', md: 'p-6', lg: 'p-8' };

export function Card({
  children,
  tone = 'default',
  padding = 'md',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  padding?: keyof typeof PADDING;
  className?: string;
}) {
  return (
    <div className={`rounded-md border ${TONES[tone]} ${PADDING[padding]} ${className}`}>
      {children}
    </div>
  );
}
