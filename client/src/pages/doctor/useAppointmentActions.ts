import { useState } from 'react';
import { messageFrom } from '../../api/client';
import { actOnAppointment } from '../../api/doctor';

/** The three things a doctor can do to one of their own consults. */
export type AppointmentAction = 'start' | 'complete' | 'cancel';

/**
 * Running one of those actions and then reloading the screen.
 *
 * Reloading rather than patching the row in place: completing a consult also
 * moves the earnings tiles and can drop the row out of the slice being shown,
 * and a screen that quietly disagrees with itself is worse than one extra
 * request.
 *
 * The in-flight rows are a set, not a single id. A doctor clearing a morning
 * clicks faster than the round trips come back, and with one id the second
 * click would re-enable the first row's buttons the moment *it* answered —
 * offering a second Complete on a consult already being completed, which the
 * server answers with a 409 the doctor did nothing to deserve.
 */
export function useAppointmentActions(reload: () => Promise<void>) {
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function act(id: string, action: AppointmentAction) {
    setBusyIds((current) => new Set(current).add(id));

    void (async () => {
      try {
        await actOnAppointment(id, action);
        await reload();
        setError(null);
      } catch (caught) {
        setError(messageFrom(caught, 'Could not update that appointment.'));
      } finally {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    })();
  }

  return { busyIds, error, setError, act };
}
