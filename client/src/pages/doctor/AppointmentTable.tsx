import type { AppointmentDto } from '@shared/types';
import {
  Button,
  StatusChip,
  TableFrame,
  money,
  paymentLabel,
  whenOf,
} from '../../components/ui';
import type { AppointmentAction } from './useAppointmentActions';

/**
 * A doctor's appointments, with the three things they can do to one.
 *
 * Shared by the day view and the full list rather than written twice — the two
 * screens differ in which appointments they ask for, not in how a row looks or
 * what a doctor may do to it.
 */

/** The statuses a consult can still be acted on from. Matches the server's. */
const OPEN = ['booked', 'checked_in', 'in_progress'];

export function AppointmentTable({
  items,
  busyId,
  onAct,
}: {
  items: AppointmentDto[];
  busyId: string | null;
  onAct: (id: string, action: AppointmentAction) => void;
}) {
  return (
    <TableFrame
      head={
        <tr>
          <th className="py-2 pr-4 font-medium">Patient</th>
          <th className="py-2 pr-4 font-medium">When</th>
          <th className="py-2 pr-4 font-medium">Fee</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 font-medium" />
        </tr>
      }
    >
      {items.map((appointment) => {
        const open = OPEN.includes(appointment.status);
        const busy = busyId === appointment.id;

        return (
          <tr key={appointment.id}>
            <td className="py-2 pr-4">
              <p className="font-medium text-ink">{appointment.patient.name}</p>
              {appointment.patient.age !== undefined && (
                <p className="text-xs text-ink-muted">{appointment.patient.age} years</p>
              )}
            </td>
            <td className="py-2 pr-4 text-ink-muted">
              <p>{whenOf(appointment.slotStart)}</p>
              <p className="text-xs">Token {appointment.tokenNumber}</p>
            </td>
            <td className="py-2 pr-4">
              <p>{money(appointment.amount)}</p>
              <p className="text-xs text-ink-muted">{paymentLabel(appointment.payment.status)}</p>
            </td>
            <td className="py-2 pr-4">
              <StatusChip status={appointment.status} />
            </td>
            <td className="py-2 text-right">
              {open && (
                <div className="flex justify-end gap-2">
                  {/* Starting a consult already in progress is a no-op the
                      server would accept; not offering it keeps the row honest
                      about what is left to do. */}
                  {appointment.status !== 'in_progress' && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => onAct(appointment.id, 'start')}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => onAct(appointment.id, 'complete')}
                  >
                    Complete
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => onAct(appointment.id, 'cancel')}
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
  );
}
