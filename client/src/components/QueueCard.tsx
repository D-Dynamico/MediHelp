import { useEffect } from 'react';
import type { AppointmentDto } from '@shared/types';
import { etaText, positionOf } from '@shared/queue';
import { Card, Chip } from './ui';
import { useQueue } from '../hooks/useQueue';

/**
 * What a patient sitting in the waiting room actually wants to know.
 *
 * Token, how many are in front, and roughly how long — updated over the socket
 * as the doctor works through the list, so nobody has to refresh a page to find
 * out whether they have been forgotten.
 *
 * It only exists on the day of an appointment the patient has checked in for.
 * A queue card on a Tuesday for a Thursday appointment is an invitation to
 * arrive two days early.
 */

export function isLiveToday(appointment: AppointmentDto): boolean {
  if (appointment.status !== 'checked_in' && appointment.status !== 'in_progress') return false;
  // The same UTC day the slot is stored in — see `format.ts` for why every date
  // in this app is read in UTC and not in the reader's zone.
  return appointment.slotStart.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

/**
 * Every line on the card is read from the live snapshot, never from the
 * appointment it was drawn for. That appointment came from a list loaded when
 * the page opened; by the time the consult has finished it still says
 * "in progress", and a card believing it would keep telling someone the doctor
 * was ready for them after they had gone home.
 *
 * `onSettled` fires when the snapshot shows this token neither waiting nor in
 * the room — the consult is over, or the patient was marked absent — so the
 * page can re-read its list, and the card, no longer live, goes away.
 */
export function QueueCard({
  appointment,
  onSettled,
}: {
  appointment: AppointmentDto;
  onSettled: () => void;
}) {
  const token = appointment.tokenNumber;
  const { snapshot, status } = useQueue(appointment.doctor.id, {
    // Pinned to the appointment's own day, so there is nothing to roll over.
    date: appointment.slotStart.slice(0, 10),
  });

  const position = snapshot ? positionOf(snapshot.waiting, token) : -1;
  const inRoom = Boolean(snapshot?.inRoom && snapshot.currentToken === token);
  const settled = snapshot !== null && !inRoom && position < 0;

  useEffect(() => {
    if (settled) onSettled();
    // Keyed on the snapshot changing, not on the callback's identity: a parent
    // that re-creates `onSettled` each render must not trigger a reload loop.
  }, [settled, snapshot?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Your token</p>
          <p className="text-h1 font-semibold tabular-nums text-ink">T-{token}</p>
        </div>

        <div className="text-right">
          {!snapshot || settled ? (
            // Nothing heard yet — or the list is being re-read. Saying
            // "You are next" here, as the card once did, is a guess presented as
            // a fact.
            <Chip tone="warning" dot>
              {status === 'live' ? 'Checking the queue' : 'Reconnecting'}
            </Chip>
          ) : inRoom ? (
            <p className="text-body font-medium text-ink">The doctor is ready for you</p>
          ) : (
            <>
              <p className="text-body text-ink">
                {position === 0
                  ? 'You are next'
                  : `${position} ${position === 1 ? 'person' : 'people'} ahead`}
              </p>
              {/* The wait is the one number here that can be wrong, so it is the
                  one the connection state replaces. Showing a stale "about 25
                  min" from ten minutes ago is worse than admitting the screen
                  has lost touch. */}
              {status === 'live' ? (
                <p className="text-sm text-ink-muted">
                  {etaText(position, snapshot.medianConsultMins)}
                </p>
              ) : (
                <span className="mt-1 inline-flex">
                  <Chip tone="warning" dot>
                    Reconnecting
                  </Chip>
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        {appointment.doctor.name} · {appointment.doctor.speciality}
      </p>
    </Card>
  );
}
