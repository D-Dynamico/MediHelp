import { useEffect, useState } from 'react';
import type { WaitlistEntryDto } from '@shared/types';
import { messageFrom } from '../api/client';
import { claimOffer, joinWaitlist, leaveWaitlist } from '../api/waitlist';
import { Button, Card, Dialog, dateOf, useToast, whenOf } from './ui';

/**
 * A patient's waitlist, on their appointments page.
 *
 * Offers first, because an offer is the only thing on the page with a clock on
 * it. Then anything that lapsed, so a card that was there a minute ago does not
 * silently vanish. Then the places still being waited in.
 */
export function WaitlistPanel({
  entries,
  onChanged,
  onClaimed,
}: {
  entries: WaitlistEntryDto[];
  /** Something here changed the list; re-read it. */
  onChanged: () => void;
  /** An offer became an appointment; the appointment list needs re-reading too. */
  onClaimed: () => void;
}) {
  const byDate = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const offers = byDate.filter((entry) => entry.state === 'offered' && entry.offer);
  const lapsed = byDate.filter((entry) => entry.state === 'expired');
  const waiting = byDate.filter((entry) => entry.state === 'waiting');

  if (offers.length + lapsed.length + waiting.length === 0) return null;

  return (
    <div className="space-y-3">
      {offers.map((entry) => (
        <OfferCard key={entry.id} entry={entry} onChanged={onChanged} onClaimed={onClaimed} />
      ))}
      {lapsed.map((entry) => (
        <LapsedCard key={entry.id} entry={entry} onChanged={onChanged} />
      ))}
      {waiting.length > 0 && (
        <section aria-label="Waitlists" className="space-y-2">
          <h2 className="text-h3 font-semibold text-ink">Waiting for a slot</h2>
          {waiting.map((entry) => (
            <WaitingCard key={entry.id} entry={entry} onChanged={onChanged} />
          ))}
        </section>
      )}
    </div>
  );
}

/** Seconds left on an offer, ticking once a second. */
function useSecondsLeft(expiresAt: string): number {
  const deadline = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, Math.round((deadline - Date.now()) / 1000)));

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return left;
}

function clock(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * An open offer: the slot, the time left, and the two choices.
 *
 * The countdown is deliberately calm — tabular, never red, never flashing. A
 * clock turning red at thirty seconds is designed to hurry people, and someone
 * deciding whether they can get to a clinic in time should not be hurried into
 * a yes. When it reaches zero the card becomes a plain "expired" state rather
 * than an error.
 */
function OfferCard({
  entry,
  onChanged,
  onClaimed,
}: {
  entry: WaitlistEntryDto;
  onChanged: () => void;
  onClaimed: () => void;
}) {
  const offer = entry.offer!;
  const left = useSecondsLeft(offer.expiresAt);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { show } = useToast();

  if (left === 0) return <LapsedCard entry={entry} onChanged={onChanged} />;

  async function onClaim() {
    setBusy(true);
    try {
      const { appointment } = await claimOffer(entry.id);
      show(
        'success',
        `Booked with ${entry.doctor.name}, ${whenOf(appointment.slotStart)}. Your token is ${appointment.tokenNumber}. Pay at the clinic.`,
      );
      onClaimed();
    } catch (caught) {
      show('error', messageFrom(caught, 'Could not claim that slot.'));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function onLetGo() {
    setConfirming(false);
    setBusy(true);
    try {
      await leaveWaitlist(entry.id);
      show('info', 'Slot let go. It has gone to the next person waiting.');
      onChanged();
    } catch (caught) {
      show('error', messageFrom(caught, 'Could not let that slot go.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="info" padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-info-fg">A slot has opened for you</p>
          <p className="text-h3 font-semibold text-ink">
            {entry.doctor.name}, {whenOf(offer.slotStart)}
          </p>
          <p className="text-sm text-ink-muted">
            Held for you until the timer runs out. You will pay at the clinic.
          </p>
        </div>
        <p
          className="text-h2 font-semibold tabular-nums text-ink"
          // Read out when it matters, not every second: a screen reader
          // announcing each tick would make the page unusable for ten minutes.
          aria-label={`${Math.ceil(left / 60)} minutes left to claim`}
        >
          {clock(left)}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button size="lg" onClick={() => void onClaim()} loading={busy}>
          Claim this slot
        </Button>
        <Button variant="quiet" size="lg" onClick={() => setConfirming(true)} disabled={busy}>
          Let it go
        </Button>
      </div>

      <Dialog
        open={confirming}
        title="Let this slot go?"
        confirmLabel="Let it go"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={() => void onLetGo()}
      >
        It goes straight to the next person waiting, and you leave the waitlist for{' '}
        {dateOf(entry.date)}. You cannot get it back.
      </Dialog>
    </Card>
  );
}

/**
 * An offer that ran out. Neutral, not a warning: nothing went wrong, the
 * patient just did not take it. "Stay on the waitlist" rejoins at the back —
 * the honest description, since the people behind them have moved up.
 */
function LapsedCard({ entry, onChanged }: { entry: WaitlistEntryDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { show } = useToast();

  async function onRejoin() {
    setBusy(true);
    try {
      await joinWaitlist(entry.doctor.id, entry.date);
      show('success', `You are back on the waitlist for ${dateOf(entry.date)}, at the end of the line.`);
      onChanged();
    } catch (caught) {
      show('error', messageFrom(caught, 'Could not rejoin the waitlist.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body font-medium text-ink">Offer expired</p>
          <p className="text-sm text-ink-muted">
            The slot with {entry.doctor.name} on {dateOf(entry.date)} has passed to the next person.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void onRejoin()} loading={busy}>
          Stay on the waitlist
        </Button>
      </div>
    </Card>
  );
}

function WaitingCard({ entry, onChanged }: { entry: WaitlistEntryDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const { show } = useToast();

  async function onLeave() {
    setBusy(true);
    try {
      await leaveWaitlist(entry.id);
      show('info', `You have left the waitlist for ${dateOf(entry.date)}.`);
      onChanged();
    } catch (caught) {
      show('error', messageFrom(caught, 'Could not leave the waitlist.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body text-ink">
            {entry.doctor.name} · {dateOf(entry.date)}
          </p>
          <p className="text-sm text-ink-muted">
            {entry.ahead === 0
              ? 'You are first in line. If a slot opens, you will be offered it here.'
              : `${entry.ahead} ${entry.ahead === 1 ? 'person' : 'people'} ahead of you.`}
          </p>
        </div>
        <Button variant="quiet" size="sm" onClick={() => void onLeave()} loading={busy}>
          Leave
        </Button>
      </div>
    </Card>
  );
}
