import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SPECIALITIES } from '@shared/types';
import type { AdminDoctorDto, Speciality } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchDoctors, removeDoctor, updateDoctor } from '../../api/admin';
import { Button, Card, Empty, ErrorNote, Loading, TableFrame, money } from '../../components/ui';

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
      <h1 className="text-xl font-semibold text-ink">Doctors</h1>

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
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
          <Loading />
        ) : doctors.length === 0 ? (
          <Empty>No doctors match that.</Empty>
        ) : (
          <TableFrame
            head={
              <tr>
                <th className="py-2 pr-4 font-medium">Doctor</th>
                <th className="py-2 pr-4 font-medium">Speciality</th>
                <th className="py-2 pr-4 font-medium">Fee</th>
                <th className="py-2 pr-4 font-medium">Taking bookings</th>
                <th className="py-2 font-medium" />
              </tr>
            }
          >
            {doctors.map((doctor) => (
              <tr key={doctor.id} className={doctor.isActive ? '' : 'opacity-60'}>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-3">
                    {doctor.image ? (
                      <img src={doctor.image} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-brand-50" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{doctor.name}</p>
                      <p className="truncate text-xs text-ink-muted">{doctor.email}</p>
                    </div>
                  </div>
                </td>
                <td className="py-2 pr-4 text-ink-muted">{doctor.speciality}</td>
                <td className="py-2 pr-4">{money(doctor.fees)}</td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    disabled={!doctor.isActive || busyId === doctor.id}
                    onClick={() => void onToggleAvailable(doctor)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
                      doctor.available ? 'bg-green-50 text-green-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {doctor.available ? 'Yes' : 'No'}
                  </button>
                </td>
                <td className="py-2 text-right">
                  <Button
                    variant={doctor.isActive ? 'danger' : 'quiet'}
                    disabled={busyId === doctor.id}
                    onClick={() => void onToggle(doctor)}
                  >
                    {doctor.isActive ? 'Remove' : 'Reinstate'}
                  </Button>
                </td>
              </tr>
            ))}
          </TableFrame>
        )}
      </Card>
    </div>
  );
}
