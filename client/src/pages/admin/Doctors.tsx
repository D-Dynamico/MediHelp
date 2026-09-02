import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SPECIALITIES } from '@shared/types';
import type { AdminDoctorDto, Speciality } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchDoctors, removeDoctor, updateDoctor } from '../../api/admin';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  Empty,
  ErrorNote,
  PageHeader,
  SkeletonTable,
  TableFrame,
  controlClasses,
  money,
} from '../../components/ui';

/**
 * The doctor list, with the two things an admin does to it: take a doctor off
 * the list, or put them back.
 *
 * The filters live in the URL rather than in state, so a filtered list can be
 * linked to — which is what the add-doctor form does when it lands here on the
 * doctor it has just created.
 */
export function AdminDoctors() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const speciality = (params.get('speciality') ?? '') as Speciality | '';
  const includeInactive = params.get('includeInactive') === 'true';

  const [doctors, setDoctors] = useState<AdminDoctorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Removing a doctor takes them off the public list and is not something to
  // do by misclick, so it goes through a confirmation like every other
  // destructive action. Reinstating does not: it is the undo.
  const [removing, setRemoving] = useState<AdminDoctorDto | null>(null);

  const load = useCallback(async () => {
    try {
      setDoctors(
        await fetchDoctors({
          ...(search ? { search } : {}),
          ...(speciality ? { speciality } : {}),
          ...(includeInactive ? { includeInactive } : {}),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load the doctors.'));
    }
  }, [search, speciality, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function onToggle(doctor: AdminDoctorDto) {
    setBusyId(doctor.id);
    try {
      // Removing is a DELETE; putting someone back is an edit. Two verbs for two
      // meanings, rather than one endpoint that flips whatever it finds.
      if (doctor.isActive) await removeDoctor(doctor.id);
      else await updateDoctor(doctor.id, { isActive: 'true' });
      await load();
    } catch (caught) {
      setError(messageFrom(caught, 'Could not change that doctor.'));
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleAvailable(doctor: AdminDoctorDto) {
    setBusyId(doctor.id);
    try {
      await updateDoctor(doctor.id, { available: String(!doctor.available) });
      await load();
    } catch (caught) {
      setError(messageFrom(caught, 'Could not change that doctor.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctors"
        description="Who is on the public list, and who is taking bookings."
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 space-y-1">
            <label htmlFor="search" className="block text-sm font-medium">
              Search
            </label>
            <input
              id="search"
              value={search}
              placeholder="Name or email"
              onChange={(event) => setParam('search', event.target.value)}
              className={controlClasses}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="speciality" className="block text-sm font-medium">
              Speciality
            </label>
            <select
              id="speciality"
              value={speciality}
              onChange={(event) => setParam('speciality', event.target.value)}
              className={controlClasses}
            >
              <option value="">All</option>
              {SPECIALITIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 py-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setParam('includeInactive', event.target.checked ? 'true' : '')}
            />
            Show removed
          </label>
        </div>

        {error && <ErrorNote message={error} />}

        {!doctors ? (
          <SkeletonTable />
        ) : doctors.length === 0 ? (
          <Empty action={{ label: 'Clear filters', onClick: () => setParams(new URLSearchParams(), { replace: true }) }}>
            No doctors match that.
          </Empty>
        ) : (
          <TableFrame
            columns={[
              {
                key: 'doctor',
                label: 'Doctor',
                render: (doctor) => (
                  <div className="flex items-center gap-3">
                    <Avatar src={doctor.image} name={doctor.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-body font-medium text-ink">{doctor.name}</p>
                      <p className="truncate text-sm text-ink-muted">{doctor.email}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'speciality',
                label: 'Speciality',
                render: (doctor) => <span className="text-ink-muted">{doctor.speciality}</span>,
              },
              { key: 'fee', label: 'Fee', align: 'right', render: (doctor) => money(doctor.fees) },
              {
                key: 'bookings',
                label: 'Taking bookings',
                render: (doctor) => (
                  <button
                    type="button"
                    disabled={!doctor.isActive || busyId === doctor.id}
                    onClick={() => void onToggleAvailable(doctor)}
                    className="rounded-full disabled:opacity-50"
                  >
                    <Chip tone={doctor.available ? 'success' : 'neutral'} dot>
                      {doctor.available ? 'Yes' : 'No'}
                    </Chip>
                  </button>
                ),
              },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (doctor) => (
                  <Button
                    size="sm"
                    variant={doctor.isActive ? 'danger' : 'secondary'}
                    loading={busyId === doctor.id}
                    onClick={() => (doctor.isActive ? setRemoving(doctor) : void onToggle(doctor))}
                  >
                    {doctor.isActive ? 'Remove' : 'Reinstate'}
                  </Button>
                ),
              },
            ]}
            rows={doctors}
            rowKey={(doctor) => doctor.id}
            renderCard={(doctor) => (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Avatar src={doctor.image} name={doctor.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-ink">{doctor.name}</p>
                    <p className="truncate text-sm text-ink-muted">{doctor.speciality}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={doctor.available ? 'success' : 'neutral'} dot>
                    {doctor.available ? 'Taking bookings' : 'Not taking bookings'}
                  </Chip>
                  <span className="text-sm text-ink-muted">{money(doctor.fees)}</span>
                </div>
                <Button
                  size="sm"
                  fullWidth
                  variant={doctor.isActive ? 'danger' : 'secondary'}
                  loading={busyId === doctor.id}
                  onClick={() => (doctor.isActive ? setRemoving(doctor) : void onToggle(doctor))}
                >
                  {doctor.isActive ? 'Remove' : 'Reinstate'}
                </Button>
              </div>
            )}
          />
        )}
      </Card>

      <Dialog
        open={removing !== null}
        destructive
        title="Remove this doctor?"
        confirmLabel="Remove"
        busy={busyId === removing?.id}
        onConfirm={() => {
          if (removing) void onToggle(removing);
          setRemoving(null);
        }}
        onClose={() => setRemoving(null)}
      >
        {removing
          ? `${removing.name} comes off the public list and takes no new bookings. Existing appointments are not cancelled, and you can reinstate them later.`
          : ''}
      </Dialog>
    </div>
  );
}
