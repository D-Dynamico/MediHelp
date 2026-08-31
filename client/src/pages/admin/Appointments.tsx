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
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  StatusChip,
  TableFrame,
  money,
  paymentLabel,
  whenOf,
} from '../../components/ui';

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
      <h1 className="text-xl font-semibold text-ink">Appointments</h1>

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
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
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
          <Loading />
        ) : data.items.length === 0 ? (
          <Empty>No appointments match that.</Empty>
        ) : (
          <>
            <TableFrame
              head={
                <tr>
                  <th className="py-2 pr-4 font-medium">Patient</th>
                  <th className="py-2 pr-4 font-medium">Doctor</th>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Payment</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              }
            >
              {data.items.map((appointment) => {
                const open = ['booked', 'checked_in', 'in_progress'].includes(appointment.status);
                return (
                  <tr key={appointment.id}>
                    <td className="py-2 pr-4">
                      <p className="font-medium text-ink">{appointment.patient.name}</p>
                      {appointment.patient.age !== undefined && (
                        <p className="text-xs text-ink-muted">{appointment.patient.age} years</p>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-ink-muted">{appointment.doctor.name}</td>
                    <td className="py-2 pr-4 text-ink-muted">
                      <p>{whenOf(appointment.slotStart)}</p>
                      <p className="text-xs">Token {appointment.tokenNumber}</p>
                    </td>
                    <td className="py-2 pr-4">
                      <p>{money(appointment.amount)}</p>
                      <p className="text-xs text-ink-muted">
                        {paymentLabel(appointment.payment.status)}
                      </p>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusChip status={appointment.status} />
                    </td>
                    <td className="py-2 text-right">
                      {open && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="quiet"
                            disabled={busyId === appointment.id}
                            onClick={() => void act(appointment.id, 'complete')}
                          >
                            Complete
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busyId === appointment.id}
                            onClick={() => void act(appointment.id, 'cancel')}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </TableFrame>

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
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(event) => onChange(id, event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
    </div>
  );
}
