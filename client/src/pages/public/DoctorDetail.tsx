import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  CalendarCheck,
  Clock,
  GraduationCap,
  MapPin,
  Wallet,
} from 'lucide-react';
import type { PaymentMode, PublicDoctorDto, SlotDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { bookAppointment, fetchDoctor, fetchSlots } from '../../api/patient';
import { PaymentAbandoned, payForAppointment } from '../../api/checkout';
import { joinWaitlist } from '../../api/waitlist';
import { SPECIALITY_ICONS } from '../../components/specialityIcons';
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
  dateOf,
  money,
  useToast,
  whenOf,
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
  const [joining, setJoining] = useState(false);
  const { show } = useToast();

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

  /**
   * Joins the waitlist for the day on screen.
   *
   * Signed out, it is the same detour as booking: to sign in and back here. A
   * doctor or an admin is never shown the option — the server would refuse
   * them, and a button that can only fail is worse than no button.
   */
  async function onJoinWaitlist() {
    if (!user) {
      navigate('/login', { state: { from: `/doctors/${id}` } });
      return;
    }
    setJoining(true);
    try {
      const entry = await joinWaitlist(id, date);
      show(
        'success',
        entry.ahead === 0
          ? `You are first on the waitlist for ${dateOf(date)}. If a slot opens, it is yours to claim.`
          : `You are on the waitlist for ${dateOf(date)}, with ${entry.ahead} ahead of you.`,
        { label: 'See my waitlist', onClick: () => navigate('/my/appointments') },
      );
    } catch (caught) {
      show('error', messageFrom(caught, 'Could not join the waitlist.'));
      // Most likely a slot came free in the meantime; the grid should say so.
      await loadSlots();
    } finally {
      setJoining(false);
    }
  }

  if (error && !doctor) return <ErrorNote message={error} />;
  if (!doctor) return <Loading />;

  const bookable = doctor.available;
  const Icon = SPECIALITY_ICONS[doctor.speciality];
  const full = slots !== null && slots.length > 0 && slots.every((slot) => !slot.available);
  const chosenSlot = slots?.find((slot) => slot.start === chosen) ?? null;

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden size={16} />
        All doctors
      </Link>

      {/* Who on the left, when on the right — and on a phone, when comes first:
          people on phones are booking, not reading. The booking panel sticks on
          a wide screen so the button never scrolls away from the grid. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <Card className="order-2 space-y-6 lg:order-1" padding="lg">
          <div className="flex items-start gap-4">
            <Avatar src={doctor.image} name={doctor.name} size="xl" />
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-h1 font-bold text-ink">{doctor.name}</h1>
              <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
                <Icon aria-hidden size={15} />
                {doctor.speciality}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <Fact icon={GraduationCap} label="Qualifications" value={doctor.degree} />
            <Fact
              icon={Award}
              label="Experience"
              value={`${doctor.experience} ${doctor.experience === 1 ? 'year' : 'years'}`}
            />
            <Fact icon={Wallet} label="Consultation" value={money(doctor.fees)} />
            <Fact icon={Clock} label="Visit length" value={`${doctor.slotDurationMins} min`} />
          </dl>

          <div className="space-y-2">
            <h2 className="text-h3 font-semibold text-ink">About</h2>
            <p className="max-w-prose text-body text-ink-muted">{doctor.about}</p>
          </div>

          <div className="flex items-start gap-3 rounded-md bg-surface-sunken p-4">
            <MapPin aria-hidden size={18} className="mt-0.5 shrink-0 text-brand-600" />
            <p className="text-sm text-ink">
              {doctor.address.line1}
              {doctor.address.line2 ? `, ${doctor.address.line2}` : ''}
            </p>
          </div>
        </Card>

        <Card className="order-1 space-y-6 lg:sticky lg:top-24 lg:order-2" padding="lg">
          <div>
            <h2 className="text-h2 font-bold text-ink">Choose a time</h2>
            <p className="text-sm text-ink-muted">
              Times are for the clinic. Pick a day, then a time.
            </p>
          </div>

          {!bookable ? (
            <Empty action={{ label: 'See other doctors', to: '/' }}>
              This doctor is not taking bookings at the moment.
            </Empty>
          ) : (
            <>
              <div
                role="group"
                aria-label="Day"
                className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2"
              >
                {days.map((day) => {
                  const key = dayKey(day);
                  const active = date === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setDate(key)}
                      className={`flex w-16 shrink-0 flex-col items-center gap-0.5 rounded-md border py-2.5 transition ${
                        active
                          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                          : 'border-line bg-surface text-ink hover:border-brand-100 hover:bg-brand-50'
                      }`}
                    >
                      <span className={`text-xs font-medium ${active ? 'text-white/80' : 'text-ink-muted'}`}>
                        {day.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}
                      </span>
                      <span className="text-h3 font-bold">{day.getUTCDate()}</span>
                      <span className={`text-xs ${active ? 'text-white/80' : 'text-ink-muted'}`}>
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
                    <Skeleton key={index} className="h-11 w-24 rounded-full" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <Empty action={{ label: 'See other doctors', to: '/' }}>
                  No times on {dateOf(date)}. Try another day.
                </Empty>
              ) : (
                // A group of one-of-many choices, announced as one. Split into
                // parts of the day so a long afternoon reads as a schedule
                // rather than a wall of buttons.
                <div role="radiogroup" aria-label="Available times" className="space-y-4">
                  {partsOfDay(slots).map(([part, group]) => (
                    <div key={part} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        {part}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.map((slot) => (
                          <button
                            key={slot.start}
                            type="button"
                            role="radio"
                            aria-checked={chosen === slot.start}
                            disabled={!slot.available}
                            onClick={() => setChosen(slot.start)}
                            className={`h-11 min-w-[5.5rem] rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-sunken disabled:text-ink-faint disabled:line-through ${
                              chosen === slot.start
                                ? 'border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-600'
                                : 'border-line-strong bg-surface text-ink hover:border-brand-500'
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
                    </div>
                  ))}
                </div>
              )}

              {/* A full day is not a dead end. Taken slots stay visible above,
                  so the day still reads as a schedule, and this is the way
                  forward. */}
              {full && (!user || user.role === 'patient') && (
                <Card tone="info" padding="sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-prose text-sm text-info-fg">
                      This day is full. Join the waitlist and, if someone cancels, the slot is
                      offered to you first, held for ten minutes while you decide.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void onJoinWaitlist()}
                      loading={joining}
                    >
                      {user ? 'Join the waitlist' : 'Sign in to join the waitlist'}
                    </Button>
                  </div>
                </Card>
              )}

              <fieldset className="space-y-3">
                <legend className="mb-3 text-h3 font-semibold text-ink">How would you like to pay?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
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
                    hint="Card or UPI, as you book."
                  />
                </div>
              </fieldset>

              {/* The summary repeats the exact slot right above the button, so
                  nobody books the wrong time. */}
              <div className="space-y-3 rounded-md bg-surface-sunken p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <CalendarCheck aria-hidden size={18} className="text-brand-600" />
                    <span className={chosenSlot ? 'font-semibold text-ink' : 'text-ink-muted'}>
                      {chosenSlot
                        ? `${whenOf(chosenSlot.start)} with ${doctor.name}`
                        : 'Choose a time to continue'}
                    </span>
                  </div>
                  <span className="text-body font-bold text-ink">{money(doctor.fees)}</span>
                </div>
                <Button onClick={() => void onBook()} disabled={!chosen || busy} size="lg" fullWidth>
                  {busy ? 'Booking…' : user ? 'Book this time' : 'Sign in to book'}
                </Button>
              </div>

              {/* Only when an assessment is actually travelling with this
                  booking. A patient who came here directly is not shown a
                  disclaimer about a thing that is not happening. */}
              {triageId && (
                <div className="space-y-1 rounded-md bg-info-bg p-3">
                  <p className="text-xs font-semibold text-info-fg">
                    Your symptom assessment will be sent to this doctor with the booking.
                  </p>
                  <TriageDisclaimer tone="quiet" />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/** One line of the doctor's facts, as a small tile. */
function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-line p-3">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        <Icon aria-hidden size={14} />
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

/**
 * Slots grouped into morning, afternoon and evening, by the clinic's own clock
 * (UTC — see `format.ts`). Empty parts are dropped rather than shown as an empty
 * heading.
 */
function partsOfDay(slots: SlotDto[]): [string, SlotDto[]][] {
  const parts: [string, SlotDto[]][] = [
    ['Morning', []],
    ['Afternoon', []],
    ['Evening', []],
  ];
  for (const slot of slots) {
    const hour = new Date(slot.start).getUTCHours();
    parts[hour < 12 ? 0 : hour < 17 ? 1 : 2]![1].push(slot);
  }
  return parts.filter(([, group]) => group.length > 0);
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
      className={`cursor-pointer rounded-md border px-4 py-3 text-sm transition ${
        checked
          ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600'
          : 'border-line-strong hover:border-ink-faint'
      }`}
    >
      <span className="flex items-center gap-2 font-medium text-ink">
        <input
          type="radio"
          name="mode"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 accent-[var(--brand-600)]"
        />
        {label}
      </span>
      <span className="mt-1 block pl-6 text-xs text-ink-muted">{hint}</span>
    </label>
  );
}
