import { useState } from 'react';
import type { AppointmentDto } from '@shared/types';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types';
import {
  Button,
  Chip,
  Dialog,
  StatusChip,
  TableFrame,
  UrgencyChip,
  money,
  paymentLabel,
  timeOf,
  whenOf,
  type Column,
} from '../../components/ui';

/**
 * Appointments as the admin reads them.
 *
 * The overview and the appointments screen were rendering the same row with two
 * different sets of columns and two different cancel buttons. One table means
 * the clinic's list looks the same wherever it appears, and the confirmation
 * dialog is written once.
 *
 * The admin sees the urgency but never the intake note: routing a clinic's day
 * needs to know that someone is urgent, and does not need to read what they
 * wrote about their own body.
 */
export function AdminAppointmentTable({
  items,
  busyId,
  onCancel,
  onComplete,
}: {
  items: AppointmentDto[];
  busyId: string | null;
  onCancel: (id: string) => void;
  /** Only the appointments screen offers this; the overview is read-mostly. */
  onComplete?: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<AppointmentDto | null>(null);

  const isOpen = (row: AppointmentDto) =>
    (OPEN_APPOINTMENT_STATUSES as readonly string[]).includes(row.status);

  const columns: Column<AppointmentDto>[] = [
    {
      key: 'patient',
      label: 'Patient',
      render: (row) => (
        <div>
          <p className="text-body font-medium text-ink">{row.patient.name}</p>
          {row.patient.age !== undefined && (
            <p className="text-sm text-ink-muted">{row.patient.age} y</p>
          )}
        </div>
      ),
    },
    { key: 'doctor', label: 'Doctor', render: (row) => <span className="text-ink-muted">{row.doctor.name}</span> },
    {
      key: 'when',
      label: 'When',
      render: (row) => (
        <div>
          <p className="text-ink">{whenOf(row.slotStart)}</p>
          <p className="text-xs text-ink-faint">T-{row.tokenNumber}</p>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip status={row.status} />
          {row.urgency && row.urgency !== 'routine' && <UrgencyChip urgency={row.urgency} />}
        </div>
      ),
    },
    {
      key: 'fee',
      label: 'Fee',
      align: 'right',
      render: (row) => (
        <div className="space-y-1">
          <p className="text-ink">{money(row.amount)}</p>
          <Chip>{paymentLabel(row.payment.status)}</Chip>
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) =>
        isOpen(row) ? (
          <div className="flex justify-end gap-1">
            {onComplete && (
              <Button size="sm" variant="secondary" loading={busyId === row.id} onClick={() => onComplete(row.id)}>
                Complete
              </Button>
            )}
            {/* Quiet, not the red outline. A red button on every row of a
                table turns the whole list into a warning; the dialog behind
                this is where the seriousness belongs. */}
            <Button
              variant="quiet"
              size="sm"
              className="hover:bg-danger-bg hover:text-danger-fg"
              onClick={() => setConfirming(row)}
            >
              Cancel
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <TableFrame
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        renderCard={(row) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body font-medium text-ink">{row.patient.name}</p>
                <p className="text-sm text-ink-muted">{row.doctor.name}</p>
              </div>
              <p className="text-sm text-ink-muted">
                {timeOf(row.slotStart)} · T-{row.tokenNumber}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={row.status} />
              {row.urgency && row.urgency !== 'routine' && <UrgencyChip urgency={row.urgency} />}
              <Chip>{paymentLabel(row.payment.status)}</Chip>
              <span className="text-sm text-ink-muted">{money(row.amount)}</span>
            </div>

            {isOpen(row) && (
              <div className="flex gap-2">
                {onComplete && (
                  <Button size="sm" variant="secondary" fullWidth loading={busyId === row.id} onClick={() => onComplete(row.id)}>
                    Complete
                  </Button>
                )}
                <Button variant="danger" size="sm" fullWidth onClick={() => setConfirming(row)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
      />

      <Dialog
        open={confirming !== null}
        destructive
        title="Cancel this appointment?"
        confirmLabel="Cancel appointment"
        onConfirm={() => {
          if (confirming) onCancel(confirming.id);
          setConfirming(null);
        }}
        onClose={() => setConfirming(null)}
      >
        {confirming
          ? `${confirming.patient.name} with ${confirming.doctor.name} at ${whenOf(confirming.slotStart)}. The slot goes back on the grid and any payment is refunded.`
          : ''}
      </Dialog>
    </>
  );
}
