import { useCallback, useEffect, useState } from 'react';
import { Copy, Monitor } from 'lucide-react';
import type { DoctorQueueDto, QueueEntryDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import {
  callNextPatient,
  checkInPatient,
  completeConsult,
  fetchBoardLink,
  fetchQueue,
  markNoShow,
} from '../../api/queue';
import { useQueue } from '../../hooks/useQueue';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Dialog,
  Empty,
  ErrorNote,
  PageHeader,
  SkeletonCard,
  UrgencyChip,
  timeOf,
  useToast,
} from '../../components/ui';

/**
 * The doctor's own queue.
 *
 * Two panels: the list of who is here on the left, and the person in the room
 * on the right with the three things the doctor does about them. The list is
 * the same one the board shows, with the names attached — which is why it comes
 * over HTTP and not over the socket.
 *
 * The socket is still what keeps this screen honest: an update means somebody
 * else changed the day (the desk checked a patient in, an appointment was
 * cancelled), so the list is re-read. The doctor's own actions return the new
 * list in their response and do not wait for the round trip.
 */

const WAITING: QueueEntryDto['status'][] = ['booked', 'checked_in'];

export function DoctorQueue() {
  const [queue, setQueue] = useState<DoctorQueueDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingNoShow, setConfirmingNoShow] = useState<QueueEntryDto | null>(null);
  const { show } = useToast();

  const load = useCallback(async () => {
    try {
      setQueue(await fetchQueue());
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load your queue.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Subscribing to the doctor's own room. The payload is ignored on purpose:
  // it carries no names, so it is a signal to re-read rather than a state to
  // render. `updatedAt` changes on every broadcast, so this fires each time.
  const { snapshot, status } = useQueue(queue?.snapshot.doctorId ?? null);
  useEffect(() => {
    if (snapshot) void load();
  }, [snapshot?.updatedAt, load]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every action is the same shape: run it, take the queue it returns, say so. */
  async function run(action: () => Promise<DoctorQueueDto>, message: string) {
    setBusy(true);
    try {
      setQueue(await action());
      setError(null);
      show('success', message);
    } catch (caught) {
      show('error', messageFrom(caught, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  async function onBoardLink() {
    try {
      const link = await fetchBoardLink();
      const url = `${window.location.origin}${link.path}`;
      await navigator.clipboard.writeText(url);
      show('success', 'Board link copied. Open it on the waiting-room screen.');
    } catch {
      // Clipboard access is refused often enough — an insecure origin, a
      // browser setting — that failing silently here would look like a broken
      // button rather than a blocked one.
      show('error', 'Could not copy the link. Check the browser clipboard permission.');
    }
  }

  const serving = queue?.entries.find((entry) => entry.status === 'in_progress') ?? null;
  const waiting = queue?.entries.filter((entry) => WAITING.includes(entry.status)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queue"
        description="Who is here, who is next, and what the waiting room is being told."
        action={
          <Button variant="secondary" size="sm" onClick={() => void onBoardLink()}>
            <Monitor aria-hidden size={16} />
            Copy board link
            <Copy aria-hidden size={16} />
          </Button>
        }
      />

      {error && <ErrorNote message={error} onRetry={() => void load()} />}

      {status !== 'live' && queue && (
        <Card tone="warning" padding="sm">
          <p className="text-sm text-warning-fg">
            Reconnecting. The list may be a moment behind until this clears.
          </p>
        </Card>
      )}

      {!queue ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : queue.entries.length === 0 ? (
        <Empty action={{ label: 'See your appointments', to: '/doctor/appointments' }}>
          Nobody is booked with you today.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <section aria-label="Waiting" className="space-y-3">
            <h2 className="text-h3 font-semibold text-ink">
              Waiting <span className="text-ink-muted">({waiting.length})</span>
            </h2>

            {waiting.length === 0 ? (
              <Card padding="sm">
                <p className="text-sm text-ink-muted">
                  Nobody is waiting. Check a patient in when they arrive at the desk.
                </p>
              </Card>
            ) : (
              waiting.map((entry) => (
                <WaitingRow
                  key={entry.appointmentId}
                  entry={entry}
                  busy={busy}
                  onCheckIn={() =>
                    void run(
                      () => checkInPatient(entry.appointmentId),
                      `${entry.patientName} is checked in.`,
                    )
                  }
                />
              ))
            )}
          </section>

          <section aria-label="Now serving" className="space-y-3">
            <h2 className="text-h3 font-semibold text-ink">Now serving</h2>

            <Card padding="lg">
              {serving ? (
                <>
                  <p className="text-display font-semibold tabular-nums text-ink">
                    T-{serving.tokenNumber}
                  </p>
                  <p className="mt-1 text-body text-ink">{serving.patientName}</p>
                  <p className="text-sm text-ink-muted">Booked for {timeOf(serving.slotStart)}</p>
                  {serving.urgency && (
                    <span className="mt-3 inline-flex">
                      <UrgencyChip urgency={serving.urgency} />
                    </span>
                  )}
                </>
              ) : (
                <>
                  <p className="text-display font-semibold tabular-nums text-ink-faint">
                    {queue.snapshot.currentToken > 0 ? `T-${queue.snapshot.currentToken}` : '—'}
                  </p>
                  <p className="mt-1 text-body text-ink-muted">
                    {queue.snapshot.currentToken > 0
                      ? 'That consult is finished. Call the next patient when you are ready.'
                      : 'The day has not started yet.'}
                  </p>
                </>
              )}

              {/* A fixed order, so the muscle memory of a busy morning always
                  lands on the same button. */}
              <div className="mt-6 flex flex-wrap gap-2">
                <Button
                  onClick={() => void run(() => callNextPatient(), 'Called the next patient in.')}
                  loading={busy}
                  disabled={Boolean(serving) || waiting.every((e) => e.status !== 'checked_in')}
                >
                  Call next
                </Button>
                <Button
                  variant="secondary"
                  disabled={!serving || busy}
                  onClick={() =>
                    serving &&
                    void run(
                      async () => (await completeConsult(serving.appointmentId)).queue,
                      'Consult completed.',
                    )
                  }
                >
                  Complete
                </Button>
                <Button
                  variant="quiet"
                  disabled={!serving || busy}
                  onClick={() => serving && setConfirmingNoShow(serving)}
                >
                  No show
                </Button>
              </div>
            </Card>

            <Card padding="sm">
              <p className="text-sm text-ink-muted">
                Typical consult: {queue.snapshot.medianConsultMins} min. This is what the waiting
                room's estimate is built on, and it is learned from your last twenty consults.
              </p>
            </Card>
          </section>
        </div>
      )}

      <Dialog
        open={confirmingNoShow !== null}
        title="Mark as a no-show?"
        confirmLabel="Mark no-show"
        destructive
        busy={busy}
        onClose={() => setConfirmingNoShow(null)}
        onConfirm={() => {
          const entry = confirmingNoShow;
          setConfirmingNoShow(null);
          if (entry) {
            void run(
              async () => (await markNoShow(entry.appointmentId)).queue,
              `${entry.patientName} marked as a no-show.`,
            );
          }
        }}
      >
        {confirmingNoShow?.patientName} will be recorded as not having attended. Their slot is
        released, and anything they paid is not refunded automatically.
      </Dialog>
    </div>
  );
}

/** One person on the left-hand list. */
function WaitingRow({
  entry,
  busy,
  onCheckIn,
}: {
  entry: QueueEntryDto;
  busy: boolean;
  onCheckIn: () => void;
}) {
  const here = entry.status === 'checked_in';

  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-h3 font-semibold tabular-nums text-ink">
          T-{entry.tokenNumber}
        </span>
        <Avatar name={entry.patientName} size="sm" {...(entry.patientImage ? { src: entry.patientImage } : {})} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-ink">{entry.patientName}</p>
          <p className="text-sm text-ink-muted">
            {timeOf(entry.slotStart)}
            {here && entry.waitingMins !== undefined && ` · waiting ${entry.waitingMins} min`}
          </p>
        </div>

        {entry.urgency && <UrgencyChip urgency={entry.urgency} />}

        {here ? (
          <Chip dot>Here</Chip>
        ) : (
          <Button variant="secondary" size="sm" onClick={onCheckIn} disabled={busy}>
            Check in
          </Button>
        )}
      </div>
    </Card>
  );
}
