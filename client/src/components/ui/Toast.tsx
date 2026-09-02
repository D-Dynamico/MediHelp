import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';

/**
 * How every mutation reports back.
 *
 * Booking, paying, cancelling, starting a consult, saving a profile — they all
 * used to leave their own inline banner in their own corner of their own
 * screen. One channel means a patient learns where to look once.
 *
 * Errors do not auto-dismiss. A success can be missed with no cost; a failure
 * that vanished before it was read is how someone books twice.
 */

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

const ICONS = {
  success: CircleCheck,
  error: CircleX,
  info: Info,
  warning: TriangleAlert,
};

const COLOURS: Record<ToastTone, string> = {
  success: 'text-success-solid',
  error: 'text-danger-solid',
  info: 'text-info-solid',
  warning: 'text-warning-solid',
};

const ToastContext = createContext<{
  show: (tone: ToastTone, message: string, action?: Toast['action']) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string, action?: Toast['action']) => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message, ...(action ? { action } : {}) }]);
      // Errors stay until dismissed; everything else clears itself.
      if (tone !== 'error') setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-md border border-line bg-surface-raised p-4 shadow-float"
            >
              <Icon aria-hidden size={20} className={`shrink-0 ${COLOURS[toast.tone]}`} />
              <p className="flex-1 text-sm text-ink">{toast.message}</p>

              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                  className="rounded-sm text-sm font-medium text-brand-500"
                >
                  {toast.action.label}
                </button>
              )}

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="rounded-sm text-ink-faint hover:text-ink"
              >
                <X aria-hidden size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider.');
  return context;
}
