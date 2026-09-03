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

export function QueueCard({ appointment }: { appointment: AppointmentDto }) {
  const { snapshot, status } = useQueue(appointment.doctor.id);

  const token = appointment.tokenNumber;
  const beingSeen =
    appointment.status === 'in_progress' || snapshot?.currentToken === token;

  const position = snapshot ? positionOf(snapshot.waiting, token) : -1;
  const peopleAhead = position < 0 ? 0 : position;

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Your token</p>
          <p className="text-h1 font-semibold tabular-nums text-ink">T-{token}</p>
        </div>

        <div className="text-right">
          {beingSeen ? (
            <p className="text-body font-medium text-ink">The doctor is ready for you</p>
          ) : (
            <>
              <p className="text-body text-ink">
                {peopleAhead === 0
                  ? 'You are next'
                  : `${peopleAhead} ${peopleAhead === 1 ? 'person' : 'people'} ahead`}
              </p>
              {/* The wait is the one number here that can be wrong, so it is the
                  one the connection state replaces. Showing a stale "about 25
                  min" from ten minutes ago is worse than admitting the screen
                  has lost touch. */}
              {status === 'live' && snapshot ? (
                <p className="text-sm text-ink-muted">
                  {etaText(peopleAhead, snapshot.medianConsultMins)}
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
