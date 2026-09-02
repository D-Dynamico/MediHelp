import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';

/**
 * A decision that cannot be undone.
 *
 * Cancelling an appointment, deactivating a doctor, letting a waitlist offer
 * go. The confirm button here is the only red *filled* button in the product
 * outside the emergency card, which is what makes a filled red button mean
 * something when one appears.
 *
 * Focus is trapped while it is open and returned to whatever opened it on
 * close, because a dialog you can tab behind is a dialog that is not really
 * modal.
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = false,
  busy = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>('button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-ink/40"
      />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md animate-fade-in rounded-md bg-surface-raised p-6 shadow-modal"
      >
        <h2 className="text-h2 font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-body text-ink-muted">{children}</div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            filled={destructive}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
