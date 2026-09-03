import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { QueueSnapshotDto } from '@shared/types';
import { QUEUE_JOIN_EVENT, QUEUE_UPDATE_EVENT } from '@shared/types';
import { dayKeyUtc } from '@shared/queue';
import { getAccessToken } from '../api/client';

/**
 * Subscribes to one doctor's queue for one day.
 *
 * Every screen that shows a live queue uses this: the patient's card, the
 * doctor's own list, and the wall display. What comes back is the public
 * snapshot — numbers only — and a connection state, because a queue screen that
 * has quietly stopped updating is worse than one that says so.
 */

export type QueueStatus = 'connecting' | 'live' | 'reconnecting';

export interface LiveQueue {
  snapshot: QueueSnapshotDto | null;
  status: QueueStatus;
}

/**
 * `doctorId` may be null while the page is still working out whose queue it is
 * showing; nothing connects until it is known. `boardToken` swaps the access
 * token for a signed board link, which is the wall display's only credential.
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

    const dayKey = date ?? dayKeyUtc();

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

    const join = () => {
      setStatus('live');
      socket.emit(QUEUE_JOIN_EVENT, { doctorId, date: dayKey });
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', () => setStatus('reconnecting'));
    socket.on(QUEUE_UPDATE_EVENT, (payload: QueueSnapshotDto) => {
      // The socket is not scoped to one doctor over its whole life — a screen
      // that navigates re-joins — so a late message from the previous room must
      // not overwrite the one being shown now.
      if (payload.doctorId === doctorId) setSnapshot(payload);
    });

    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [doctorId, boardToken, date]);

  return { snapshot, status };
}
