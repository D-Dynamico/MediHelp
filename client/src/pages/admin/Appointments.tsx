import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { APPOINTMENT_STATUSES } from '@shared/types';
import type { AppointmentStatus } from '@shared/types';
import { messageFrom } from '../../api/client';
import {
  cancelAppointment,
  completeAppointment,
  fetchAppointments,
  type AppointmentPage,
} from '../../api/admin';
import {
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Pagination,
  SkeletonTable,
  controlClasses,
} from '../../components/ui';
import { AdminAppointmentTable } from './AdminAppointmentTable';

/** Every appointment in the clinic, filtered and paged, with the two actions. */
export function AdminAppointments() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as AppointmentStatus | '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [data, setData] = useState<AppointmentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(
        await fetchAppointments({
          ...(status ? { status } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          page,
          pageSize: 20,
        }),
      );
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load the appointments.'));
    }
  }, [status, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to a filter invalidates the page number: page 4 of the old
    // result set is rarely page 4 of the new one, and is often past the end.
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  async function act(id: string, action: 'cancel' | 'complete') {
    setBusyId(id);
    try {
      if (action === 'cancel') await cancelAppointment(id);
      else await completeAppointment(id);
      await load();
    } catch (caught) {
      setError(messageFrom(caught, 'Could not update that appointment.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="Every appointment in the clinic, filtered and paged."
      />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="status" className="block text-sm font-medium">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
              className={controlClasses}
            >
              <option value="">All</option>
              {APPOINTMENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <DateFilter id="from" label="From" value={from} onChange={setParam} />
          <DateFilter id="to" label="To" value={to} onChange={setParam} />
        </div>

        {error && <ErrorNote message={error} />}

        {!data ? (
          <SkeletonTable />
        ) : data.items.length === 0 ? (
          <Empty action={{ label: 'Clear filters', onClick: () => setParams(new URLSearchParams(), { replace: true }) }}>
            No appointments match that.
          </Empty>
        ) : (
          <>
            <AdminAppointmentTable
              items={data.items}
              busyId={busyId}
              onCancel={(id) => void act(id, 'cancel')}
              onComplete={(id) => void act(id, 'complete')}
            />

            <Pagination
              page={data.page}
              pages={data.pages}
              onChange={(page) => setParam('page', String(page))}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function DateFilter({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Field label={label}>
      {(props) => (
        <Input
          {...props}
          type="date"
          value={value}
          onChange={(event) => onChange(id, event.target.value)}
        />
      )}
    </Field>
  );
}
