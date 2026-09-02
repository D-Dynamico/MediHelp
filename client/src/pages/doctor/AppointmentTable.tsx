import type { AppointmentDto, AppointmentStatus } from '@shared/types';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types';
import {
  Button,
  StatusChip,
  TableFrame,
  TriageDisclaimer,
  UrgencyChip,
  money,
  paymentLabel,
  whenOf,
} from '../../components/ui';
import type { AppointmentAction } from './useAppointmentActions';

/**
 * The statuses a consult can still be acted on from — the server's own list,
 * imported rather than retyped, so adding a status there cannot leave these
 * rows silently without buttons.
 */
function isOpen(status: AppointmentStatus): boolean {
  return (OPEN_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/**
 * A doctor's appointments, with the three things they can do to one.
 *
 * Shared by the day view and the full list rather than written twice — the two
 * screens differ in which appointments they ask for, not in how a row looks or
 * what a doctor may do to it.
 */
export function AppointmentTable({
  items,
  busyIds,
  onAct,
}: {
  items: AppointmentDto[];
  /** Every row with an action still in flight, not just the latest one. */
  busyIds: ReadonlySet<string>;
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
        const open = isOpen(appointment.status);
        const busy = busyIds.has(appointment.id);

        return (
          <tr key={appointment.id}>
            <td className="py-2 pr-4">
              <p className="font-medium text-ink">{appointment.patient.name}</p>
              {appointment.patient.age !== undefined && (
                <p className="text-xs text-ink-muted">{appointment.patient.age} years</p>
              )}
              {/* Folded away rather than shown in full: most rows have no note,
                  and an open one on every row would push the day off the screen.
                  It is one click, on the row the doctor is already reading. */}
              {appointment.intakeNote && (
                <details className="mt-1 max-w-md">
                  <summary className="cursor-pointer text-xs text-brand-700">
                    Before the consult
                  </summary>
                  <p className="mt-1 whitespace-pre-line text-xs text-ink-muted">
                    {appointment.intakeNote}
                  </p>
                  {/* The doctor is reading a machine's summary of a patient's
                      own words. Saying so where they read it matters more than
                      saying it once on a screen they never see. */}
                  <div className="mt-1">
                    <TriageDisclaimer tone="quiet" />
                  </div>
                </details>
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
              <div className="flex flex-wrap items-center gap-1">
                <StatusChip status={appointment.status} />
                {appointment.urgency && <UrgencyChip urgency={appointment.urgency} />}
              </div>
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
