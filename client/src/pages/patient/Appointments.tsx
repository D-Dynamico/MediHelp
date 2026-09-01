import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types';
import type { AppointmentDto, AppointmentStatus } from '@shared/types';
import { messageFrom } from '../../api/client';
import { cancelMyAppointment, fetchMyAppointments, type AppointmentPage } from '../../api/patient';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  StatusChip,
  money,
  paymentLabel,
  whenOf,
} from '../../components/ui';

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
    } catch (caught) {
      setError(messageFrom(caught, 'Could not cancel that appointment.'));
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">My appointments</h1>

      {booked && (
        <Card className="border-green-200 bg-green-50">
          <h2 className="font-semibold text-green-900">You&rsquo;re booked.</h2>
          <p className="mt-1 text-sm text-green-900">
            {booked.doctor.name} · {whenOf(booked.slotStart)} · token {booked.tokenNumber}
          </p>
          <p className="mt-1 text-sm text-green-900">
            {money(booked.amount)} to pay at the clinic. Bring your token number.
          </p>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {SCOPES.map((scope) => (
          <button
            key={scope.value}
            type="button"
            onClick={() => setScope(scope.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              when === scope.value
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-muted hover:bg-surface'
            }`}
          >
            {scope.label}
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Card>
          <Empty>
            Nothing here yet.{' '}
            <Link to="/" className="font-medium text-brand-700 underline">
              Find a doctor
            </Link>
            .
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              highlighted={appointment.id === justBooked}
              busy={busyId === appointment.id}
              onCancel={() => void onCancel(appointment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentRow({
  appointment,
  highlighted,
  busy,
  onCancel,
}: {
  appointment: AppointmentDto;
  highlighted: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <Card className={highlighted ? 'border-green-300' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{appointment.doctor.name}</p>
            <StatusChip status={appointment.status} />
          </div>
          <p className="text-sm text-ink-muted">{appointment.doctor.speciality}</p>
          <p className="text-sm text-ink">{whenOf(appointment.slotStart)}</p>
          <p className="text-xs text-ink-muted">
            Token {appointment.tokenNumber} · {money(appointment.amount)} ·{' '}
            {paymentLabel(appointment.payment.status)}
          </p>
        </div>

        {isOpen(appointment.status) && (
          <Button variant="danger" onClick={onCancel} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
      </div>
    </Card>
  );
}
