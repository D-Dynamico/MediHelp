import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types';
import type { AppointmentDto, AppointmentStatus } from '@shared/types';
import { messageFrom } from '../../api/client';
import { cancelMyAppointment, fetchMyAppointments, type AppointmentPage } from '../../api/patient';
import { PaymentAbandoned, payForAppointment } from '../../api/checkout';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  Empty,
  ErrorNote,
  PageHeader,
  SkeletonCard,
  StatusChip,
  Tabs,
  money,
  paymentLabel,
  timeOf,
  useToast,
  whenOf,
} from '../../components/ui';
import { isLiveToday, QueueCard } from '../../components/QueueCard';
import { WaitlistPanel } from '../../components/WaitlistPanel';
import { useWaitlist } from '../../hooks/useWaitlist';

/**
 * A patient's own appointments, and the confirmation of one just booked.
 *
 * The confirmation is this screen with `?booked=<id>` rather than a page of its
 * own. What a patient wants right after booking — the time, the token, what to
 * pay — is exactly what the row already shows, and landing them here means the
 * next thing they see is where the appointment will always live.
 */

const SCOPES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
] as const;

type Scope = (typeof SCOPES)[number]['value'];

function scopeFrom(raw: string | null): Scope {
  return SCOPES.some((scope) => scope.value === raw) ? (raw as Scope) : 'upcoming';
}

function isOpen(status: AppointmentStatus): boolean {
  return (OPEN_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

export function MyAppointments() {
  const [params, setParams] = useSearchParams();
  const when = scopeFrom(params.get('when'));
  const justBooked = params.get('booked');

  const [data, setData] = useState<AppointmentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null);
  const paymentNote = params.get('payment');
  const { show } = useToast();
  const waitlist = useWaitlist(true);

  const load = useCallback(async () => {
    try {
      setData(await fetchMyAppointments({ when, pageSize: 50 }));
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load your appointments.'));
    }
  }, [when]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCancel(id: string) {
    setBusyId(id);
    try {
      await cancelMyAppointment(id);
      await load();
      show('success', 'Appointment cancelled. Any payment is on its way back.');
    } catch (caught) {
      setError(messageFrom(caught, 'Could not cancel that appointment.'));
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Pays an appointment that is booked but still owing.
   *
   * The same call the booking screen makes, offered again here because a
   * payment can fail or be closed without the appointment being lost — the slot
   * is held either way, and this is where a patient comes back to finish.
   */
  async function onPay(appointment: AppointmentDto) {
    setBusyId(appointment.id);
    setError(null);
    try {
      await payForAppointment(appointment.id, appointment.doctor.name);
      await load();
      show('success', 'Payment received.');
    } catch (caught) {
      // Reloaded even here: a payment can settle at the gateway and still fail
      // on the way back, and leaving "Pay now" on a row that is already paid
      // invites paying twice. The list is the server's answer, not ours.
      //
      // Before the message, not after: `load` clears the error on success, so
      // the other order would wipe the very thing being reported.
      await load();
      if (!(caught instanceof PaymentAbandoned)) {
        setError(messageFrom(caught, 'The payment did not go through.'));
      }
    } finally {
      setBusyId(null);
    }
  }

  function setScope(next: Scope) {
    const params = new URLSearchParams();
    params.set('when', next);
    // The confirmation banner belongs to the booking that was just made, not to
    // whatever list the patient browses to next.
    setParams(params, { replace: true });
  }

  const booked = data?.items.find((appointment) => appointment.id === justBooked);

  /**
   * The appointment the live queue card is about, if there is one.
   *
   * Read off whichever list is on screen rather than fetched separately — a
   * checked-in appointment is by definition today's, so it is in "upcoming" and
   * in "all", and the patient looking for their token is on one of those.
   */
  const live = data?.items.find(isLiveToday);

  /**
   * The confirmation, as a toast rather than a banner.
   *
   * It fires once, when the just-booked row has actually arrived, so it can name
   * the token number. The row stays highlighted underneath — the toast is the
   * announcement, the row is the record.
   *
   * A payment that fell over is reported separately and as a warning, which does
   * not auto-dismiss: the slot is held either way, and someone who misses this
   * turns up at the clinic thinking they have paid.
   */
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!booked || announced.current === booked.id) return;
    announced.current = booked.id;

    show(
      'success',
      `Booked with ${booked.doctor.name}, ${whenOf(booked.slotStart)}. Your token is ${booked.tokenNumber}.`,
    );

    if (paymentNote) {
      show(
        'warning',
        paymentNote === 'unpaid'
          ? 'The payment window closed, so this is still unpaid. You can pay below, or at the clinic.'
          : `${paymentNote} The appointment is still yours — pay below, or at the clinic.`,
      );
    }
  }, [booked, paymentNote, show]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My appointments"
        description="Everything you have booked, and what is still to pay."
      />

      <Tabs
        label="Which appointments"
        value={when}
        options={SCOPES.map((scope) => ({ value: scope.value, label: scope.label }))}
        onChange={setScope}
      />

      {error && <ErrorNote message={error} />}

      {/* Always first, and only on the day. Someone in the waiting room is
          looking for one number, and it should not be below a list. */}
      {live && <QueueCard appointment={live} onSettled={() => void load()} />}

      {/* Between the queue card and the list: an offer has a clock on it, and
          nothing below it does. */}
      {waitlist.entries && (
        <WaitlistPanel
          entries={waitlist.entries}
          onChanged={() => void waitlist.reload()}
          onClaimed={() => {
            void waitlist.reload();
            void load();
          }}
        />
      )}

      {!data ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : data.items.length === 0 ? (
        <Empty action={{ label: 'Find a doctor', to: '/' }}>
          You have no appointments here yet.
        </Empty>
      ) : (
        <div className="space-y-3">
          {data.items.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              highlighted={appointment.id === justBooked}
              busy={busyId === appointment.id}
              onCancel={() => setCancelling(appointment)}
              onPay={() => void onPay(appointment)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={cancelling !== null}
        destructive
        title="Cancel this appointment?"
        confirmLabel="Cancel appointment"
        busy={busyId === cancelling?.id}
        onConfirm={() => {
          if (cancelling) void onCancel(cancelling.id);
          setCancelling(null);
        }}
        onClose={() => setCancelling(null)}
      >
        {cancelling
          ? `${cancelling.doctor.name} at ${whenOf(cancelling.slotStart)}. The time goes back on the grid, and anything you have paid is refunded.`
          : ''}
      </Dialog>
    </div>
  );
}

function AppointmentRow({
  appointment,
  highlighted,
  busy,
  onCancel,
  onPay,
}: {
  appointment: AppointmentDto;
  highlighted: boolean;
  busy: boolean;
  onCancel: () => void;
  onPay: () => void;
}) {
  // Only an online booking that is still open and still owing has anything to
  // pay here. Cash is settled at the desk, and a finished consult is not a
  // checkout.
  const owing =
    appointment.payment.mode === 'razorpay' &&
    isOpen(appointment.status) &&
    appointment.payment.status !== 'paid';

  const when = new Date(appointment.slotStart);

  return (
    <Card
      padding="none"
      className={`overflow-hidden ${highlighted ? 'ring-2 ring-brand-500' : ''}`}
    >
      <div className="flex">
        {/* The date as a calendar leaf. A list of appointments is read by
            "when" first, so "when" gets the one strong shape on the card. */}
        <div
          className={`flex w-20 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-line py-4 sm:w-24 ${
            isOpen(appointment.status) ? 'bg-brand-50 text-brand-700' : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          <span className="text-xs font-semibold uppercase">
            {when.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}
          </span>
          <span className="text-display font-bold leading-none">{when.getUTCDate()}</span>
          <span className="text-xs font-medium">
            {when.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar
              name={appointment.doctor.name}
              size="md"
              {...(appointment.doctor.image ? { src: appointment.doctor.image } : {})}
            />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-ink">{appointment.doctor.name}</p>
                <StatusChip status={appointment.status} />
              </div>
              <p className="text-sm text-ink-muted">
                {appointment.doctor.speciality} · {timeOf(appointment.slotStart)}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Chip>Token T-{appointment.tokenNumber}</Chip>
                <Chip tone={appointment.payment.status === 'paid' ? 'success' : 'neutral'}>
                  {paymentLabel(appointment.payment.status)}
                </Chip>
                <span className="text-sm font-semibold text-ink">{money(appointment.amount)}</span>
              </div>
            </div>
          </div>

          {isOpen(appointment.status) && (
            <div className="flex gap-2">
              {owing && (
                <Button size="sm" onClick={onPay} loading={busy}>
                  Pay now
                </Button>
              )}
              <Button
                variant="quiet"
                size="sm"
                className="hover:bg-danger-bg hover:text-danger-fg"
                onClick={onCancel}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
