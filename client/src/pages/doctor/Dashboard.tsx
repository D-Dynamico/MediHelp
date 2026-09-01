import { useCallback, useEffect, useState } from 'react';
import type { AppointmentDto, DoctorEarningsDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { fetchAppointments, fetchEarnings } from '../../api/doctor';
import { Card, Empty, ErrorNote, Loading, StatTile, money } from '../../components/ui';
import { AppointmentTable } from './AppointmentTable';
import { useAppointmentActions } from './useAppointmentActions';

/**
 * The doctor's day: what they have earned, and who is still to be seen today.
 *
 * The two requests go out together rather than one after the other — neither
 * needs the other's answer, and waiting for the earnings before asking for the
 * list would show an empty table for no reason.
 */
export function DoctorDashboard() {
  const [earnings, setEarnings] = useState<DoctorEarningsDto | null>(null);
  const [today, setToday] = useState<AppointmentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextEarnings, nextToday] = await Promise.all([
        fetchEarnings(),
        fetchAppointments({ when: 'today', pageSize: 50 }),
      ]);
      setEarnings(nextEarnings);
      setToday(nextToday.items);
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load your day.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useAppointmentActions(load);

  if (error && !earnings) return <ErrorNote message={error} />;
  if (!earnings || !today) return <Loading />;

  const notice = error ?? actions.error;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Today</h1>

      {notice && <ErrorNote message={notice} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Earned"
          value={money(earnings.total)}
          hint="Completed and paid consults"
        />
        <StatTile label="This month" value={money(earnings.thisMonth)} />
        <StatTile label="Consults" value={String(earnings.appointments)} hint="All time" />
        <StatTile
          label="Patients"
          value={String(earnings.patients)}
          hint="People, not appointments"
        />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink">Today&rsquo;s appointments</h2>

        {today.length === 0 ? (
          <Empty>Nothing booked for today.</Empty>
        ) : (
          <AppointmentTable items={today} busyIds={actions.busyIds} onAct={actions.act} />
        )}
      </Card>
    </div>
  );
}
