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
 */
export function useAppointmentActions(reload: () => Promise<void>) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(id: string, action: AppointmentAction) {
    setBusyId(id);
    void (async () => {
      try {
        await actOnAppointment(id, action);
        await reload();
        setError(null);
      } catch (caught) {
        setError(messageFrom(caught, 'Could not update that appointment.'));
      } finally {
        setBusyId(null);
      }
    })();
  }

  return { busyId, error, setError, act };
}
