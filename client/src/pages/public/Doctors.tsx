import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SPECIALITIES } from '@shared/types';
import type { PublicDoctorDto, Speciality } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchDoctors } from '../../api/patient';
import { Card, Empty, ErrorNote, Loading, money } from '../../components/ui';

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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-ink">Find a doctor</h1>
        <p className="text-sm text-ink-muted">
          Pick a speciality, or search by name. Booking takes a minute and needs an account.
        </p>
      </header>

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
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 sm:max-w-sm"
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
        <Loading />
      ) : doctors.length === 0 ? (
        <Empty>No doctors match that. Try a different speciality.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <DoctorCard key={doctor.id} doctor={doctor} />
          ))}
        </div>
      )}
    </div>
  );
}

function DoctorCard({ doctor }: { doctor: PublicDoctorDto }) {
  return (
    <Link
      to={`/doctors/${doctor.id}`}
      className="rounded-xl border border-brand-100 bg-surface p-5 shadow-sm transition hover:border-brand-300 hover:shadow"
    >
      <div className="flex items-center gap-3">
        {doctor.image ? (
          <img
            src={doctor.image}
            alt=""
            className="h-14 w-14 rounded-full border border-brand-100 object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-700">
            {doctor.name.charAt(0)}
          </div>
        )}
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
        <span className={doctor.available ? 'text-green-700' : 'text-ink-muted'}>
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
        active ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
      }`}
    >
      {children}
    </button>
  );
}
