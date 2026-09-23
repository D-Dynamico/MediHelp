import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { QueueSnapshotDto } from '@shared/types';
import { QUEUE_JOIN_EVENT, QUEUE_UPDATE_EVENT } from '@shared/types';
import { dayKeyUtc } from '@shared/queue';
import { getAccessToken, refreshSession } from '../api/client';

/**
 * Subscribes to one doctor's queue for one day.
 *
 * Every screen that shows a live queue uses this: the patient's card, the
 * doctor's own list, and the wall display. What comes back is the public
 * snapshot — numbers only — and a connection state, because a queue screen that
 * has quietly stopped updating is worse than one that says so.
 */

/**
 * `refused` is the one state that does not heal on its own: the server turned
 * the credential away. For a signed-in screen that is handled here by renewing
 * the session; for a wall display it means the board link itself has expired.
 */
export type QueueStatus = 'connecting' | 'live' | 'reconnecting' | 'refused';

export interface LiveQueue {
  snapshot: QueueSnapshotDto | null;
  status: QueueStatus;
}

/** Milliseconds until the next UTC midnight, plus a second of slack. */
function untilNextUtcDay(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime() + 1000;
}

/**
 * `doctorId` may be null while the page is still working out whose queue it is
 * showing; nothing connects until it is known. `boardToken` swaps the access
 * token for a signed board link, which is the wall display's only credential.
 *
 * `date` pins the queue to one day. Without it the hook follows **today** — and
 * keeps following it across midnight, which is what a board left on overnight
 * needs.
 */
export function useQueue(
  doctorId: string | null,
  options: { boardToken?: string; date?: string } = {},
): LiveQueue {
  const { boardToken, date } = options;
  const [snapshot, setSnapshot] = useState<QueueSnapshotDto | null>(null);
  const [status, setStatus] = useState<QueueStatus>('connecting');

  useEffect(() => {
    if (!doctorId) return undefined;

    let closed = false;
    let dayKey = date ?? dayKeyUtc();
    let rollover: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const socket = io({
      // A function, not an object: the access token is refreshed in the
      // background and rotates. Read once at connect, a reconnection an hour
      // later would present the token that expired forty-five minutes ago.
      auth: (send) => {
        send(boardToken ? { board: boardToken } : { token: getAccessToken() ?? '' });
      },
      // Sockets are the app's only long-lived connection, and a waiting room's
      // wifi drops. Backing off to ten seconds keeps a display that has been
      // unplugged from hammering the server all night.
      reconnectionDelayMax: 10_000,
    });

    /**
     * Joins the room for the day being shown, and — when following today —
     * arranges to move to tomorrow's room when the day turns. The key is worked
     * out at each join, not once: a board switched on in the evening and left
     * running would otherwise sit in yesterday's room all of the next day,
     * showing the final state of a queue that has closed.
     */
    const join = () => {
      if (!date) dayKey = dayKeyUtc();
      setStatus('live');
      socket.emit(QUEUE_JOIN_EVENT, { doctorId, date: dayKey });

      clearTimeout(rollover);
      if (!date) {
        rollover = setTimeout(() => {
          if (socket.connected) join();
        }, untilNextUtcDay());
      }
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', () => {
      // While `active` is true Socket.IO is still retrying by itself. It goes
      // false only when the server refused the handshake, and from there it
      // never tries again — so a screen whose access token expired during a
      // wifi drop would say "Reconnecting" until someone reloaded the page.
      if (socket.active) {
        setStatus('reconnecting');
        return;
      }
      if (boardToken) {
        setStatus('refused');
        return;
      }
      setStatus('reconnecting');
      void refreshSession().then((token) => {
        // No token means the session is over, and the client has already sent
        // the person to sign in. A short pause before retrying keeps a server
        // that is refusing everyone from being asked again in a tight loop.
        if (token && !closed) retry = setTimeout(() => socket.connect(), 1000);
      });
    });

    socket.on(QUEUE_UPDATE_EVENT, (payload: QueueSnapshotDto) => {
      // A late message from a room this socket has since left — another doctor,
      // or yesterday — must not overwrite the one being shown now.
      if (payload.doctorId === doctorId && payload.date === dayKey) setSnapshot(payload);
    });

    return () => {
      closed = true;
      clearTimeout(rollover);
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.close();
    };
  }, [doctorId, boardToken, date]);

  return { snapshot, status };
}
