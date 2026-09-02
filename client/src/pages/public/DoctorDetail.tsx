import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PaymentMode, PublicDoctorDto, SlotDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { bookAppointment, fetchDoctor, fetchSlots } from '../../api/patient';
import { PaymentAbandoned, payForAppointment } from '../../api/checkout';
import { useAuth } from '../../hooks/useAuth';
import {
  Button,
  Card,
  Avatar,
  Empty,
  ErrorNote,
  Loading,
  Skeleton,
  TriageDisclaimer,
  money,
} from '../../components/ui';

/**
 * A doctor's page, and the booking on it.
 *
 * The date strip is a fixed run of days from today rather than a calendar
 * widget: a clinic books weeks out, not years, and a strip of the next fortnight
 * is one tap where a date picker is three.
 */

/** How many days the strip offers. Comfortably inside the server's horizon. */
const STRIP_DAYS = 14;

/** "YYYY-MM-DD" in UTC — the same day boundary the server reasons in. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextDays(count: number): Date[] {
  const today = new Date();
  return Array.from({ length: count }, (_, offset) => {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() + offset);
    return day;
  });
}

export function DoctorDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  // Carried from a triage result through the catalogue. It travels in the URL
  // rather than in router state so that a link a patient shares or reopens
  // still reaches the assessment, and the doctor still gets the note.
  const [params] = useSearchParams();
  const triageId = params.get('triage') ?? '';

  const [doctor, setDoctor] = useState<PublicDoctorDto | null>(null);
  const [days] = useState(() => nextDays(STRIP_DAYS));
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setDoctor(await fetchDoctor(id));
      } catch (caught) {
        setError(messageFrom(caught, 'Could not find that doctor.'));
      }
    })();
  }, [id]);

  const loadSlots = useCallback(async () => {
    setSlots(null);
    try {
      setSlots(await fetchSlots(id, date));
    } catch (caught) {
      // An empty list, not null: null is what the panel renders "Loading times…"
      // for, so leaving it there showed a spinner that never resolved alongside
      // the error message. Picking another day is the retry.
      setSlots([]);
      setError(messageFrom(caught, 'Could not load the times for that day.'));
    }
  }, [id, date]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  // A slot picked on one day means nothing on another.
  useEffect(() => {
    setChosen(null);
  }, [date]);

  async function onBook() {
    if (!chosen) return;

    if (!user) {
      // Somewhere to come back to. Signing in is a detour, not a dead end.
      navigate('/login', {
        state: { from: `/doctors/${id}${triageId ? `?triage=${triageId}` : ''}` },
      });
      return;
    }

    setBusy(true);
    setError(null);

    let appointmentId: string;
    try {
      const appointment = await bookAppointment({
        doctorId: id,
        slotStart: chosen,
        mode,
        ...(triageId ? { triageId } : {}),
      });
      appointmentId = appointment.id;
    } catch (caught) {
      setError(messageFrom(caught, 'Could not book that time.'));
      // Whatever went wrong, the grid is now out of date — most likely because
      // someone else took the slot a moment before.
      await loadSlots();
      setChosen(null);
      setBusy(false);
      return;
    }

    // The slot is held from here on. Paying is a separate step, and a payment
    // that falls over must not lose the appointment: it stays booked and
    // unpaid, and the appointments page offers the payment again.
    if (mode === 'razorpay') {
      try {
        await payForAppointment(appointmentId, doctor?.name ?? 'your doctor');
      } catch (caught) {
        const note =
          caught instanceof PaymentAbandoned
            ? 'unpaid'
            : messageFrom(caught, 'The payment did not go through.');
        navigate(`/my/appointments?booked=${appointmentId}&payment=${encodeURIComponent(note)}`);
        return;
      }
    }

    navigate(`/my/appointments?booked=${appointmentId}`);
    setBusy(false);
  }

  if (error && !doctor) return <ErrorNote message={error} />;
  if (!doctor) return <Loading />;

  const bookable = doctor.available;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar src={doctor.image} name={doctor.name} size="xl" />

          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-h1 font-semibold text-ink">{doctor.name}</h1>
            <p className="text-sm text-ink-muted">
              {doctor.speciality} · {doctor.degree} · {doctor.experience} years&rsquo; experience
            </p>
            <p className="text-sm text-ink-muted">
              {doctor.address.line1}
              {doctor.address.line2 ? `, ${doctor.address.line2}` : ''}
            </p>
            <p className="pt-2 text-sm text-ink">{doctor.about}</p>
          </div>

          <div className="space-y-1 text-right">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Consultation</p>
            <p className="text-h2 font-semibold text-ink">{money(doctor.fees)}</p>
            <p className="text-xs text-ink-muted">{doctor.slotDurationMins} minutes</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-ink">Pick a time</h2>

        {!bookable ? (
          <Empty action={{ label: 'See other doctors', to: '/' }}>
            This doctor is not taking bookings at the moment.
          </Empty>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((day) => {
                const key = dayKey(day);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDate(key)}
                    className={`flex min-w-16 flex-col items-center rounded-md px-3 py-2 text-sm transition ${
                      date === key
                        ? 'bg-brand-500 text-white'
                        : 'bg-surface-sunken text-ink-muted hover:bg-brand-50'
                    }`}
                  >
                    <span className="text-xs">
                      {day.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
                    </span>
                    <span className="font-semibold">{day.getUTCDate()}</span>
                    <span className="text-xs">
                      {day.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && <ErrorNote message={error} />}

            {!slots ? (
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="h-11 w-20" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <Empty action={{ label: 'See other doctors', to: '/' }}>
                No times on this day. Try another.
              </Empty>
            ) : (
              // A group of one-of-many choices, announced as one. Individual
              // buttons left a screen reader to infer the relationship, and the
              // selected time was only ever signalled by colour.
              <div role="radiogroup" aria-label="Available times" className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    role="radio"
                    aria-checked={chosen === slot.start}
                    disabled={!slot.available}
                    onClick={() => setChosen(slot.start)}
                    className={`min-h-11 rounded-sm border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-sunken disabled:text-ink-faint disabled:line-through ${
                      chosen === slot.start
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-line-strong text-ink hover:border-ink-faint'
                    }`}
                  >
                    {new Date(slot.start).toLocaleTimeString('en-IN', {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: 'UTC',
                    })}
                  </button>
                ))}
              </div>
            )}

            <fieldset className="space-y-2 border-t border-line pt-4">
              <legend className="text-sm font-medium">How would you like to pay?</legend>
              <div className="flex flex-wrap gap-2">
                <PayOption
                  checked={mode === 'cash'}
                  onChange={() => setMode('cash')}
                  label="At the clinic"
                  hint="Pay the desk when you arrive."
                />
                <PayOption
                  checked={mode === 'razorpay'}
                  onChange={() => setMode('razorpay')}
                  label="Online now"
                  hint="Pay by card or UPI as you book."
                />
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void onBook()} disabled={!chosen || busy}>
                {busy ? 'Booking…' : user ? 'Book this time' : 'Sign in to book'}
              </Button>
              <p className="text-sm text-ink-muted">
                {chosen
                  ? `${money(doctor.fees)}, ${
                      mode === 'cash' ? 'paid at the clinic' : 'paid online now'
                    }.`
                  : 'Choose a time to continue.'}
              </p>
            </div>

            {/* Only when an assessment is actually travelling with this
                booking. A patient who came here directly is not shown a
                disclaimer about a thing that is not happening. */}
            {triageId && (
              <div className="space-y-1 rounded-md bg-surface-sunken p-3">
                <p className="text-xs font-medium text-ink">
                  Your symptom assessment will be sent to this doctor with the booking.
                </p>
                <TriageDisclaimer tone="quiet" />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function PayOption({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm transition ${
        checked ? 'border-brand-500 bg-brand-50' : 'border-line-strong hover:border-ink-faint'
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-ink">
        <input type="radio" name="mode" checked={checked} onChange={onChange} className="h-4 w-4" />
        {label}
      </span>
      <span className="mt-1 block pl-6 text-xs text-ink-muted">{hint}</span>
    </label>
  );
}
