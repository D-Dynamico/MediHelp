import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SPECIALITIES } from '@shared/types';
import type { PublicDoctorDto, Speciality } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchDoctors } from '../../api/patient';
import {
  Avatar,
  Button,
  Card,
  Empty,
  ErrorNote,
  PageHeader,
  SkeletonCard,
  controlClasses,
  money,
} from '../../components/ui';

/**
 * The clinic's front door: every doctor, filtered by speciality or searched by
 * name.
 *
 * Filters live in the URL, so a filtered list can be bookmarked, shared, or
 * linked to from the triage result in phase 8 — "here are the dermatologists"
 * is then a link rather than a state nobody else can reach.
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find a doctor"
        description="Pick a speciality, or search by name. Booking takes a minute and needs an account."
      />

      {triageId ? (
        // The suggestion is a filter, never a lock. Saying so on the page — with
        // the way out right beside it — is the difference between a
        // recommendation and a decision made for someone.
        <Card tone="info" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
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
        </Card>
      ) : (
        <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Not sure which kind of doctor you need?</p>
          <Button as="link" to="/triage" variant="secondary" size="sm">
            Describe your symptoms instead
          </Button>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="search" className="block text-sm font-medium">
            Search
          </label>
          <input
            id="search"
            value={search}
            placeholder="Name, speciality or qualification"
            onChange={(event) => setParam('search', event.target.value)}
            className={`${controlClasses} sm:max-w-sm`}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Chip active={speciality === ''} onClick={() => setParam('speciality', '')}>
            All
          </Chip>
          {SPECIALITIES.map((option) => (
            <Chip
              key={option}
              active={speciality === option}
              onClick={() => setParam('speciality', option)}
            >
              {option}
            </Chip>
          ))}
        </div>
      </Card>

      {error && <ErrorNote message={error} />}

      {!doctors ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : doctors.length === 0 ? (
        <Empty action={{ label: 'Clear filters', onClick: () => setParams(new URLSearchParams(), { replace: true }) }}>
          No doctors match that.
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <DoctorCard key={doctor.id} doctor={doctor} triageId={triageId} />
          ))}
        </div>
      )}
    </div>
  );
}

function DoctorCard({ doctor, triageId }: { doctor: PublicDoctorDto; triageId: string }) {
  return (
    <Link
      to={`/doctors/${doctor.id}${triageId ? `?triage=${triageId}` : ''}`}
      className="rounded-md border border-line bg-surface p-5 transition hover:border-line-strong"
    >
      <div className="flex items-center gap-3">
        <Avatar src={doctor.image} name={doctor.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{doctor.name}</p>
          <p className="truncate text-sm text-ink-muted">{doctor.speciality}</p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{doctor.about}</p>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-medium text-ink">{money(doctor.fees)}</span>
        {/* Said plainly rather than by hiding the card. A doctor who is not
            taking anyone right now is still someone a patient may be looking
            for. */}
        <span className={doctor.available ? 'text-success-fg' : 'text-ink-muted'}>
          {doctor.available ? 'Taking bookings' : 'Not booking now'}
        </span>
      </div>
    </Link>
  );
}

function Chip({
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
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-50'
      }`}
    >
      {children}
    </button>
  );
}
