import type { AppointmentStatus, PaymentStatus, Urgency } from '@shared/types';
import type { Tone } from './Card';

/**
 * A small piece of state.
 *
 * One component with a tone, and two thin wrappers that own the mapping. The
 * mapping is the interesting part: cancelled and no-show are **grey with a
 * struck-through label, never red**, because red is spent on emergencies and a
 * cancelled appointment is not one. If every unhappy outcome is red, red stops
 * meaning anything.
 */

const TONES: Record<Tone | 'neutral', string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  default: 'bg-surface-sunken text-ink-muted',
  info: 'bg-info-bg text-info-fg',
  success: 'bg-success-bg text-success-fg',
  warning: 'bg-warning-bg text-warning-fg',
  danger: 'bg-danger-bg text-danger-fg',
};

const DOTS: Record<Tone | 'neutral', string> = {
  neutral: 'bg-ink-faint',
  default: 'bg-ink-faint',
  info: 'bg-info-solid',
  success: 'bg-success-solid',
  warning: 'bg-warning-solid',
  danger: 'bg-danger-solid',
};

export function Chip({
  children,
  tone = 'neutral',
  dot = false,
  struck = false,
}: {
  children: React.ReactNode;
  tone?: Tone | 'neutral';
  dot?: boolean;
  struck?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${TONES[tone]}`}
    >
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} />}
      <span className={struck ? 'line-through' : undefined}>{children}</span>
    </span>
  );
}

const STATUS: Record<AppointmentStatus, { label: string; tone: Tone | 'neutral'; struck?: boolean }> = {
  booked: { label: 'Booked', tone: 'neutral' },
  checked_in: { label: 'Checked in', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral', struck: true },
  no_show: { label: 'No show', tone: 'neutral', struck: true },
};

export function StatusChip({ status }: { status: AppointmentStatus }) {
  const { label, tone, struck } = STATUS[status];
  return (
    <Chip tone={tone} dot struck={struck}>
      {label}
    </Chip>
  );
}

const URGENCY: Record<Urgency, { label: string; tone: Tone }> = {
  routine: { label: 'Routine', tone: 'info' },
  urgent: { label: 'Urgent', tone: 'warning' },
  emergency: { label: 'Emergency', tone: 'danger' },
};

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  const { label, tone } = URGENCY[urgency];
  return <Chip tone={tone}>{label}</Chip>;
}

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone | 'neutral' }> = {
  pending: { label: 'Payment pending', tone: 'neutral' },
  pending_at_desk: { label: 'Pay at desk', tone: 'neutral' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Payment failed', tone: 'warning' },
  refunded: { label: 'Refunded', tone: 'neutral' },
};

export function PaymentChip({ status }: { status: PaymentStatus }) {
  const { label, tone } = PAYMENT[status];
  return <Chip tone={tone}>{label}</Chip>;
}

export function paymentLabel(status: PaymentStatus): string {
  return PAYMENT[status].label;
}
