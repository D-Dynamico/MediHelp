import type { ReactNode } from 'react';
import type { AppointmentStatus, PaymentStatus } from '@shared/types';

/**
 * The small pieces every dashboard screen repeats: a card, a stat tile, a
 * status chip, and the two states a table can be in before it has rows.
 *
 * Kept in one file rather than one file each. They are a handful of lines apiece
 * and always used together; splitting them would be five imports for what reads
 * as one vocabulary.
 */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-brand-100 bg-surface p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="space-y-1">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

/** Rupees, grouped the Indian way — this is a clinic in Bengaluru. */
export function money(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

/** A slot time as a person would say it. */
export function whenOf(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  booked: 'bg-brand-50 text-brand-700',
  checked_in: 'bg-amber-50 text-amber-800',
  in_progress: 'bg-amber-100 text-amber-900',
  completed: 'bg-green-50 text-green-800',
  cancelled: 'bg-slate-100 text-slate-600',
  no_show: 'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: 'Booked',
  checked_in: 'Checked in',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

export function StatusChip({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  pending: 'Payment pending',
  pending_at_desk: 'Pay at desk',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export function paymentLabel(status: PaymentStatus): string {
  return PAYMENT_LABELS[status];
}

/** Shown while a screen's first request is in flight. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="p-6 text-sm text-ink-muted">{label}</p>;
}

/** Shown when a request failed, with the API's own message. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/** Shown when a request succeeded and there was simply nothing to show. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-6 text-center text-sm text-ink-muted">{children}</p>;
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    quiet: 'border border-slate-300 text-ink hover:bg-surface-sunken',
    danger: 'border border-red-200 text-red-700 hover:bg-red-50',
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

/**
 * A table that scrolls sideways rather than squashing.
 *
 * Appointment rows carry a patient, a doctor, a time, a status and a payment;
 * on a narrow screen something has to give, and a horizontal scroll loses less
 * than columns that wrap into each other.
 */
export function TableFrame({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-brand-100 text-xs uppercase tracking-wide text-ink-muted">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}
