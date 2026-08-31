import { useCallback, useEffect, useState } from 'react';
import type { AdminDashboardDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { cancelAppointment, fetchDashboard } from '../../api/admin';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  StatTile,
  StatusChip,
  TableFrame,
  money,
  whenOf,
} from '../../components/ui';

/** The clinic at a glance, and the five newest bookings with a way to cancel. */
export function AdminDashboard() {
  const [data, setData] = useState<AdminDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchDashboard());
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load the dashboard.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCancel(id: string) {
    setBusyId(id);
    try {
      await cancelAppointment(id);
      // Reloading rather than patching the row in place: cancelling changes the
      // tiles as well, and a screen that quietly disagrees with itself is worse
      // than one extra request.
      await load();
    } catch (caught) {
      setError(messageFrom(caught, 'Could not cancel that appointment.'));
    } finally {
      setBusyId(null);
    }
  }

  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Dashboard</h1>

      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Doctors" value={String(data.counts.doctors)} />
        <StatTile label="Patients" value={String(data.counts.patients)} />
        <StatTile
          label="Appointments"
          value={String(data.counts.appointments)}
          hint={`${data.todayUpcoming} still to come today`}
        />
        <StatTile label="Revenue" value={money(data.revenue)} hint="Collected, not booked" />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">Latest bookings</h2>

        {data.latestBookings.length === 0 ? (
          <Empty>No bookings yet.</Empty>
        ) : (
          <TableFrame
            head={
              <tr>
                <th className="py-2 pr-4 font-medium">Patient</th>
                <th className="py-2 pr-4 font-medium">Doctor</th>
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Fee</th>
                <th className="py-2 font-medium" />
              </tr>
            }
          >
            {data.latestBookings.map((appointment) => (
              <tr key={appointment.id}>
                <td className="py-2 pr-4">{appointment.patient.name}</td>
                <td className="py-2 pr-4 text-ink-muted">{appointment.doctor.name}</td>
                <td className="py-2 pr-4 text-ink-muted">{whenOf(appointment.slotStart)}</td>
                <td className="py-2 pr-4">
                  <StatusChip status={appointment.status} />
                </td>
                <td className="py-2 pr-4">{money(appointment.amount)}</td>
                <td className="py-2 text-right">
                  {/* Only an appointment that has not happened yet can be called off. */}
                  {['booked', 'checked_in', 'in_progress'].includes(appointment.status) && (
                    <Button
                      variant="danger"
                      disabled={busyId === appointment.id}
                      onClick={() => void onCancel(appointment.id)}
                    >
                      {busyId === appointment.id ? 'Cancelling…' : 'Cancel'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </TableFrame>
        )}
      </Card>
    </div>
  );
}
