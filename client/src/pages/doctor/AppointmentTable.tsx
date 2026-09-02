import { useState } from 'react';
import type { AppointmentDto, AppointmentStatus } from '@shared/types';
import { OPEN_APPOINTMENT_STATUSES } from '@shared/types';
import { Ellipsis, FileText } from 'lucide-react';
import {
  Button,
  Chip,
  Dialog,
  IconButton,
  StatusChip,
  TableFrame,
  TriageDisclaimer,
  UrgencyChip,
  money,
  paymentLabel,
  timeOf,
  whenOf,
  type Column,
} from '../../components/ui';
import type { AppointmentAction } from './useAppointmentActions';

/**
 * A doctor's appointments, and the one thing to do to each.
 *
 * The row used to carry three buttons — Start, Complete, Cancel — on every open
 * appointment, which is most of a doctor's screen spent on choices they are not
 * making. Now it shows the single action the state actually calls for: a booked
 * consult offers Start, one in progress offers Complete, and Cancel lives in an
 * overflow behind a confirmation. That is the biggest density win available
 * here, and it removes the misclick that cancelled a consult meant to be
 * started.
 *
 * The urgency chip appears only when it is urgent or an emergency. A column
 * that says "Routine" on every row is a column that teaches you not to read it.
 */

function isOpen(status: AppointmentStatus): boolean {
  return (OPEN_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);
}

/** The one action this state calls for, or none. */
function nextAction(status: AppointmentStatus): { action: AppointmentAction; label: string } | null {
  if (status === 'in_progress') return { action: 'complete', label: 'Complete' };
  if (isOpen(status)) return { action: 'start', label: 'Start' };
  return null;
}

export function AppointmentTable({
  items,
  busyIds,
  onAct,
}: {
  items: AppointmentDto[];
  busyIds: ReadonlySet<string>;
  onAct: (id: string, action: AppointmentAction) => void;
}) {
  const [noteFor, setNoteFor] = useState<AppointmentDto | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null);

  const columns: Column<AppointmentDto>[] = [
    {
      key: 'patient',
      label: 'Patient',
      render: (row) => (
        <div className="space-y-1">
          <p className="text-body font-medium text-ink">{row.patient.name}</p>
          {row.patient.age !== undefined && (
            <p className="text-sm text-ink-muted">{row.patient.age} y</p>
          )}
          {row.intakeNote && (
            <Button variant="quiet" size="sm" onClick={() => setNoteFor(row)}>
              <FileText aria-hidden size={16} />
              Triage note
            </Button>
          )}
        </div>
      ),
    },
    {
      key: 'time',
      label: 'Time',
      render: (row) => (
        <div>
          <p className="text-body text-ink">{whenOf(row.slotStart)}</p>
          <p className="text-xs text-ink-faint">T-{row.tokenNumber}</p>
        </div>
      ),
    },
    {
      key: 'payment',
      label: 'Payment',
      align: 'right',
      render: (row) => (
        <div className="space-y-1">
          <p className="text-body text-ink">{money(row.amount)}</p>
          <Chip>{paymentLabel(row.payment.status)}</Chip>
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
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) => <RowActions row={row} onCancel={setCancelling} onAct={onAct} busy={busyIds.has(row.id)} />,
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
                {row.patient.age !== undefined && (
                  <p className="text-sm text-ink-muted">{row.patient.age} y</p>
                )}
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

            {row.intakeNote && (
              <Button variant="quiet" size="sm" onClick={() => setNoteFor(row)}>
                <FileText aria-hidden size={16} />
                Triage note
              </Button>
            )}

            <RowActions row={row} onCancel={setCancelling} onAct={onAct} busy={busyIds.has(row.id)} fullWidth />
          </div>
        )}
      />

      {/* The note is a dialog rather than an inline `<details>`: a doctor reads
          it once, before the consult, and an expanded note pushed every other
          row of the day off the screen. */}
      <Dialog
        open={noteFor !== null}
        title="Before the consult"
        confirmLabel="Close"
        onConfirm={() => setNoteFor(null)}
        onClose={() => setNoteFor(null)}
      >
        <div className="space-y-3">
          {noteFor?.urgency && <UrgencyChip urgency={noteFor.urgency} />}
          <p className="whitespace-pre-line text-body text-ink">{noteFor?.intakeNote}</p>
          <TriageDisclaimer tone="quiet" />
        </div>
      </Dialog>

      <Dialog
        open={cancelling !== null}
        destructive
        title="Cancel this appointment?"
        confirmLabel="Cancel appointment"
        onConfirm={() => {
          if (cancelling) onAct(cancelling.id, 'cancel');
          setCancelling(null);
        }}
        onClose={() => setCancelling(null)}
      >
        {cancelling
          ? `${cancelling.patient.name} at ${whenOf(cancelling.slotStart)}. The slot goes back on the grid and any payment is refunded.`
          : ''}
      </Dialog>
    </>
  );
}

function RowActions({
  row,
  busy,
  onAct,
  onCancel,
  fullWidth,
}: {
  row: AppointmentDto;
  busy: boolean;
  onAct: (id: string, action: AppointmentAction) => void;
  onCancel: (row: AppointmentDto) => void;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const next = nextAction(row.status);

  if (!next) return null;

  return (
    <div className={`flex items-center gap-1 ${fullWidth ? '' : 'justify-end'}`}>
      <Button
        size="sm"
        variant={next.action === 'complete' ? 'primary' : 'secondary'}
        loading={busy}
        fullWidth={fullWidth}
        onClick={() => onAct(row.id, next.action)}
      >
        {next.label}
      </Button>

      <div className="relative">
        <IconButton
          label="More actions"
          variant="quiet"
          size="sm"
          onClick={() => setOpen((current) => !current)}
        >
          <Ellipsis aria-hidden size={16} />
        </IconButton>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-line bg-surface-raised p-1 shadow-float">
              <button
                type="button"
                className="w-full rounded-sm px-3 py-2 text-left text-sm text-danger-fg hover:bg-danger-bg"
                onClick={() => {
                  setOpen(false);
                  onCancel(row);
                }}
              >
                Cancel appointment
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
