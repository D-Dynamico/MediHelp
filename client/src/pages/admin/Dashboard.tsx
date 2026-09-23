import { useCallback, useEffect, useState } from 'react';
import type { AdminDashboardDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { cancelAppointment, fetchDashboard } from '../../api/admin';
import { CalendarDays, Stethoscope, Users, Wallet } from 'lucide-react';
import {
  Button,
  Empty,
  ErrorNote,
  PageHeader,
  Section,
  SkeletonTable,
  StatTile,
  money,
} from '../../components/ui';
import { AdminAppointmentTable } from './AdminAppointmentTable';

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
  if (!data) return <SkeletonTable />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="The clinic at a glance, and the newest bookings."
      />

      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={Stethoscope} label="Doctors" value={String(data.counts.doctors)} />
        <StatTile icon={Users} label="Patients" value={String(data.counts.patients)} />
        <StatTile
          icon={CalendarDays}
          label="Appointments"
          value={String(data.counts.appointments)}
          hint={`${data.todayUpcoming} still to come today`}
        />
        <StatTile
          icon={Wallet}
          label="Revenue"
          value={money(data.revenue)}
          hint="Collected, not booked"
        />
      </div>

      <Section
        title="Latest bookings"
        action={
          <Button as="link" to="/admin/appointments" variant="quiet" size="sm">
            See all
          </Button>
        }
      >
        {data.latestBookings.length === 0 ? (
          <Empty action={{ label: 'Add a doctor', to: '/admin/doctors/new' }}>
            No bookings yet.
          </Empty>
        ) : (
          <AdminAppointmentTable
            items={data.latestBookings}
            busyId={busyId}
            onCancel={(id) => void onCancel(id)}
          />
        )}
      </Section>
    </div>
  );
}
