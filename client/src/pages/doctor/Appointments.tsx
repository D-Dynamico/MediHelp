import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAppointments, type AppointmentPage, type AppointmentWhen } from '../../api/doctor';
import { messageFrom } from '../../api/client';
import { Button, Card, Empty, ErrorNote, Loading } from '../../components/ui';
import { AppointmentTable } from './AppointmentTable';
import { useAppointmentActions } from './useAppointmentActions';

/**
 * A doctor's whole book, in the three slices they actually ask for.
 *
 * The slice and the page live in the URL rather than in component state, so a
 * doctor who reloads the tab, or keeps last week's list open in a second one,
 * gets back what they were looking at.
 */

const SCOPES: { value: AppointmentWhen; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

function scopeFrom(raw: string | null): AppointmentWhen {
  return SCOPES.some((scope) => scope.value === raw) ? (raw as AppointmentWhen) : 'upcoming';
}

export function DoctorAppointments() {
  const [params, setParams] = useSearchParams();
  const when = scopeFrom(params.get('when'));
  const page = Number(params.get('page') ?? '1');

  const [data, setData] = useState<AppointmentPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchAppointments({ when, page, pageSize: 20 }));
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load your appointments.'));
    }
  }, [when, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useAppointmentActions(load);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the slice invalidates the page number: page 3 of "past" is not
    // page 3 of "upcoming", and is often past the end.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const notice = error ?? actions.error;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Appointments</h1>

      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((scope) => (
            <button
              key={scope.value}
              type="button"
              onClick={() => setParam('when', scope.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                when === scope.value
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-muted hover:bg-surface-sunken'
              }`}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {notice && <ErrorNote message={notice} />}

        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <Empty>Nothing here yet.</Empty>
        ) : (
          <>
            <AppointmentTable items={data.items} busyId={actions.busyId} onAct={actions.act} />

            <div className="flex items-center justify-between pt-2 text-sm text-ink-muted">
              <span>
                {data.total} appointment{data.total === 1 ? '' : 's'} · page {data.page} of{' '}
                {data.pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="quiet"
                  disabled={data.page <= 1}
                  onClick={() => setParam('page', String(data.page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="quiet"
                  disabled={data.page >= data.pages}
                  onClick={() => setParam('page', String(data.page + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
