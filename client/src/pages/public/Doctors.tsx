import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BellRing, Radio, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { SPECIALITIES } from '@shared/types';
import type { PublicDoctorDto, Speciality } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchDoctors } from '../../api/patient';
import { SPECIALITY_ICONS } from '../../components/specialityIcons';
import {
  Avatar,
  Button,
  Card,
  Empty,
  ErrorNote,
  SkeletonCard,
  money,
} from '../../components/ui';

/**
 * The clinic's front door: who we are in one line, a search, and every doctor.
 *
 * It opens with a welcome rather than a filter form. Someone arriving from a
 * search engine has not decided to book yet; the first screen has to say what
 * this place is and make the next step obvious — the search box — before it
 * asks them to choose among eight specialities.
 *
 * Filters live in the URL, so a filtered list can be bookmarked, shared, or
 * linked to from a triage result — "here are the dermatologists" is then a link
 * rather than a state nobody else can reach.
 */
export function Doctors() {
  const [params, setParams] = useSearchParams();
  const speciality = (params.get('speciality') ?? '') as Speciality | '';
  const search = params.get('search') ?? '';
  // Carried through from a triage result, so that whichever doctor the patient
  // picks, the booking can still reach the assessment and the doctor gets the
  // note. The catalogue itself does nothing with it but pass it along.
  const triageId = params.get('triage') ?? '';

  const [doctors, setDoctors] = useState<PublicDoctorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDoctors(
        await fetchDoctors({
          ...(speciality ? { speciality } : {}),
          ...(search ? { search } : {}),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load the doctors.'));
    }
  }, [speciality, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const filtered = Boolean(speciality || search);

  return (
    <div className="space-y-12">
      {triageId ? (
        <header className="space-y-4">
          <h1 className="text-h1 font-bold text-ink">Doctors for your symptoms</h1>
          {/* The suggestion is a filter, never a lock. Saying so on the page —
              with the way out right beside it — is the difference between a
              recommendation and a decision made for someone. */}
          <Card tone="info" padding="sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-info-fg">
                {speciality
                  ? 'Suggested from your symptoms. You can book any doctor you like.'
                  : 'Showing every doctor. Your assessment still travels with the booking.'}
              </p>
              {speciality && (
                <Button variant="secondary" size="sm" onClick={() => setParam('speciality', '')}>
                  Show all doctors
                </Button>
              )}
            </div>
          </Card>
        </header>
      ) : (
        <Hero search={search} onSearch={(value) => setParam('search', value)} />
      )}

      <section aria-labelledby="doctors-heading" className="space-y-6" id="doctors">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="doctors-heading" className="text-h1 font-bold text-ink">
              {speciality ? `${speciality}s` : 'Our doctors'}
            </h2>
            <p className="text-sm text-ink-muted">
              {doctors
                ? `${doctors.length} ${doctors.length === 1 ? 'doctor' : 'doctors'}${
                    search ? ` matching “${search}”` : ''
                  }`
                : 'Loading…'}
            </p>
          </div>
          {filtered && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                const next = new URLSearchParams();
                if (triageId) next.set('triage', triageId);
                setParams(next, { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* One row that scrolls sideways on a phone, rather than eight pills
            wrapping into a block of buttons above the list. */}
        <div
          role="group"
          aria-label="Filter by speciality"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          <SpecialityPill active={speciality === ''} onClick={() => setParam('speciality', '')}>
            All
          </SpecialityPill>
          {SPECIALITIES.map((option) => {
            const Icon = SPECIALITY_ICONS[option];
            return (
              <SpecialityPill
                key={option}
                active={speciality === option}
                onClick={() => setParam('speciality', option)}
              >
                <Icon aria-hidden size={16} />
                {option}
              </SpecialityPill>
            );
          })}
        </div>

        {error && <ErrorNote message={error} onRetry={() => void load()} />}

        {!doctors ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : doctors.length === 0 ? (
          <Empty
            action={{
              label: 'Clear filters',
              onClick: () => setParams(new URLSearchParams(), { replace: true }),
            }}
          >
            No doctors match that. Try another speciality, or clear the search.
          </Empty>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.map((doctor) => (
              <DoctorCard key={doctor.id} doctor={doctor} triageId={triageId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The opening: what this is, a search, and the three things that make it
 * different — each true of this product, none of them stock copy.
 *
 * The search is live, the same one the list below reads, so typing narrows the
 * doctors straight away rather than needing a submit.
 */
function Hero({ search, onSearch }: { search: string; onSearch: (value: string) => void }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-line bg-gradient-to-br from-brand-50 via-surface to-surface px-6 py-10 shadow-card sm:px-10 lg:py-14">
      <div className="grid items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-surface px-3 py-1 text-xs font-semibold text-brand-700">
            <Sparkles aria-hidden size={14} />
            Live queue · Auto-waitlist · Symptom check
          </p>

          <div className="space-y-3">
            <h1 className="text-display font-bold text-ink lg:text-hero">
              Care that fits
              <br className="hidden sm:block" /> around your day.
            </h1>
            <p className="max-w-lg text-body text-ink-muted">
              Book a verified doctor in under a minute. See your place in the queue live, and if a
              full day frees up, we offer you the slot.
            </p>
          </div>

          <form
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              document.getElementById('doctors')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex max-w-xl items-center gap-2 rounded-full border border-line-strong bg-surface p-1.5 pl-5 shadow-card transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-50"
          >
            <Search aria-hidden size={20} className="shrink-0 text-ink-faint" />
            <label htmlFor="doctor-search" className="sr-only">
              Search doctors
            </label>
            <input
              id="doctor-search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Doctor, speciality or qualification"
              className="h-11 min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <Button type="submit" className="hidden sm:inline-flex">
              Find a doctor
            </Button>
          </form>

          <Link
            to="/triage"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Not sure who to see? Describe your symptoms
            <ArrowRight aria-hidden size={16} />
          </Link>
        </div>

        <QueuePreview />
      </div>

      <ul className="mt-10 grid gap-4 border-t border-line pt-6 sm:grid-cols-3">
        <Feature icon={ShieldCheck} title="Verified doctors">
          Every doctor is added by the clinic, not by themselves.
        </Feature>
        <Feature icon={Radio} title="The queue, live">
          Your token and wait on your phone, updated as it moves.
        </Feature>
        <Feature icon={BellRing} title="Never miss a slot">
          Join a full day's waitlist and get offered the next cancellation.
        </Feature>
      </ul>
    </section>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon aria-hidden size={19} />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{children}</p>
      </div>
    </li>
  );
}

/**
 * A picture of the live queue card, drawn in the app's own components.
 *
 * Illustration, not data — hidden from assistive technology, and on large
 * screens only. It shows the one thing no other booking page has, in the form
 * the patient will actually meet it.
 */
function QueuePreview() {
  return (
    <div aria-hidden className="hidden lg:block">
      <div className="relative mx-auto max-w-sm">
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-brand-100 blur-2xl" />
        <div className="relative rotate-1 rounded-lg border border-line bg-surface p-6 shadow-float">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink-muted">Your token</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success-fg">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success-solid" />
              Live
            </span>
          </div>
          <p className="mt-1 text-display font-bold tabular-nums text-ink">T-14</p>
          <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
            <div>
              <p className="text-body font-semibold text-ink">2 people ahead</p>
              <p className="text-sm text-ink-muted">About 20 min</p>
            </div>
            <p className="text-sm text-ink-muted">Now serving T-12</p>
          </div>
        </div>
        <div className="relative -mt-3 ml-8 -rotate-2 rounded-md border border-info-solid/20 bg-info-bg px-4 py-3 shadow-card">
          <p className="text-sm font-semibold text-info-fg">A slot has opened for you</p>
          <p className="text-xs text-info-fg/80">Thu, 11:30 · held for 9:42</p>
        </div>
      </div>
    </div>
  );
}

function DoctorCard({ doctor, triageId }: { doctor: PublicDoctorDto; triageId: string }) {
  const Icon = SPECIALITY_ICONS[doctor.speciality];

  return (
    <Link
      to={`/doctors/${doctor.id}${triageId ? `?triage=${triageId}` : ''}`}
      className="group flex flex-col rounded-md border border-line bg-surface p-5 shadow-card transition hover:-translate-y-0.5 hover:border-brand-100 hover:shadow-float"
    >
      <div className="flex items-start gap-4">
        <Avatar src={doctor.image} name={doctor.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-bold text-ink">{doctor.name}</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
            <Icon aria-hidden size={15} />
            {doctor.speciality}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {doctor.degree} · {doctor.experience} {doctor.experience === 1 ? 'year' : 'years'}
          </p>
        </div>
      </div>

      <p className="mt-4 line-clamp-2 flex-1 text-sm text-ink-muted">{doctor.about}</p>

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <div>
          <p className="text-body font-bold text-ink">{money(doctor.fees)}</p>
          {/* Said plainly rather than by hiding the card. A doctor who is not
              taking anyone right now is still someone a patient may be looking
              for. */}
          <p
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              doctor.available ? 'text-success-fg' : 'text-ink-muted'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                doctor.available ? 'bg-success-solid' : 'bg-ink-faint'
              }`}
            />
            {doctor.available ? 'Taking bookings' : 'Not booking now'}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition group-hover:bg-brand-600 group-hover:text-white">
          Book
          <ArrowRight aria-hidden size={15} />
        </span>
      </div>
    </Link>
  );
}

function SpecialityPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
        active
          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
          : 'border-line bg-surface text-ink-muted hover:border-brand-100 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
