import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PublicDoctorDto, SlotDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { bookAppointment, fetchDoctor, fetchSlots } from '../../api/patient';
import { useAuth } from '../../hooks/useAuth';
import { Button, Card, Empty, ErrorNote, Loading, money } from '../../components/ui';

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

  const [doctor, setDoctor] = useState<PublicDoctorDto | null>(null);
  const [days] = useState(() => nextDays(STRIP_DAYS));
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [slots, setSlots] = useState<SlotDto[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
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
      navigate('/login', { state: { from: `/doctors/${id}` } });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const appointment = await bookAppointment({
        doctorId: id,
        slotStart: chosen,
        // Cash only until phase 7 wires a gateway. Offering "pay online" before
        // there is anything behind it would be a button that lies.
        mode: 'cash',
      });
      navigate(`/my/appointments?booked=${appointment.id}`);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not book that time.'));
      // Whatever went wrong, the grid is now out of date — most likely because
      // someone else took the slot a moment before.
      await loadSlots();
      setChosen(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !doctor) return <ErrorNote message={error} />;
  if (!doctor) return <Loading />;

  const bookable = doctor.available;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          {doctor.image ? (
            <img
              src={doctor.image}
              alt=""
              className="h-24 w-24 rounded-full border border-brand-100 object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-50 text-2xl font-semibold text-brand-700">
              {doctor.name.charAt(0)}
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-2xl font-semibold text-ink">{doctor.name}</h1>
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
            <p className="text-xl font-semibold text-ink">{money(doctor.fees)}</p>
            <p className="text-xs text-ink-muted">{doctor.slotDurationMins} minutes</p>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold text-ink">Pick a time</h2>

        {!bookable ? (
          <Empty>This doctor is not taking bookings at the moment.</Empty>
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
              <Loading label="Loading times…" />
            ) : slots.length === 0 ? (
              <Empty>No times on this day. Try another.</Empty>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.start}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setChosen(slot.start)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-surface-sunken disabled:text-slate-400 disabled:line-through ${
                      chosen === slot.start
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : 'border-slate-300 text-ink hover:border-brand-400'
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

            <div className="flex flex-wrap items-center gap-3 border-t border-brand-100 pt-4">
              <Button onClick={() => void onBook()} disabled={!chosen || busy}>
                {busy ? 'Booking…' : user ? 'Book this time' : 'Sign in to book'}
              </Button>
              <p className="text-sm text-ink-muted">
                {chosen
                  ? `${money(doctor.fees)}, paid at the clinic.`
                  : 'Choose a time to continue.'}
              </p>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
