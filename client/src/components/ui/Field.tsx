import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A labelled form control.
 *
 * Every form in the app used to hand-roll label, control and error, which is
 * how a placeholder ends up being the only label on one screen and the error
 * ends up unannounced on another. `Field` owns the wiring: the id, the
 * `aria-describedby`, the error styling and the "(optional)" suffix.
 *
 * Required fields carry no asterisk. Most fields are required; marking the
 * exceptions is less noise and tells the reader more.
 */

// Taller than before (44px, a thumb's width) and with a soft focus halo in the
// brand tint alongside the outline, so where you are typing is obvious.
const CONTROL =
  'h-11 w-full rounded-sm border bg-surface px-3.5 text-body text-ink placeholder:text-ink-faint ' +
  'transition hover:border-ink-faint focus:border-brand-500 focus:ring-4 focus:ring-brand-50 ' +
  'disabled:opacity-50';

export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Given the id and the describedby to wire onto the control. */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </label>

      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}

      {hint && !error && (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

type ControlProps = { error?: boolean; className?: string };

export function Input({
  error,
  className = '',
  ...rest
}: ControlProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={`${CONTROL} ${error ? 'border-danger-solid' : 'border-line-strong'} ${className}`}
    />
  );
}

export function Textarea({
  error,
  className = '',
  ...rest
}: ControlProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={`${CONTROL} h-auto min-h-[6.5rem] py-2 ${
        error ? 'border-danger-solid' : 'border-line-strong'
      } ${className}`}
    />
  );
}

export function Select({
  error,
  className = '',
  children,
  ...rest
}: ControlProps & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...rest}
        className={`${CONTROL} appearance-none pr-9 ${
          error ? 'border-danger-solid' : 'border-line-strong'
        } ${className}`}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

/** The shared control classes, for the few places that must style their own. */
export const controlClasses = CONTROL;
