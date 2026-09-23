import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './client';

/**
 * The app's live connection, opened the same way everywhere.
 *
 * Two things want one — a queue screen following a doctor's day, and a
 * patient's own screen listening for waitlist offers — and both need the same
 * two behaviours that are easy to get wrong, so they live here once.
 */

export type SocketState = 'live' | 'reconnecting' | 'refused';

export interface LiveSocket {
  socket: Socket;
  close: () => void;
}

export function openSocket(options: {
  /** A signed board link instead of the signed-in session. */
  boardToken?: string;
  onState: (state: SocketState) => void;
}): LiveSocket {
  const { boardToken, onState } = options;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const socket = io({
    // A function, not an object: the access token is refreshed in the
    // background and rotates. Read once at connect, a reconnection an hour
    // later would present the token that expired forty-five minutes ago.
    auth: (send) => {
      send(boardToken ? { board: boardToken } : { token: getAccessToken() ?? '' });
    },
    // A waiting room's wifi drops. Backing off to ten seconds keeps a display
    // that has been unplugged from hammering the server all night.
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect', () => onState('live'));
  socket.on('disconnect', () => onState('reconnecting'));
  socket.on('connect_error', () => {
    // While `active` is true Socket.IO is still retrying by itself. It goes
    // false only when the server refused the handshake, and from there it never
    // tries again — so a screen whose access token expired during a wifi drop
    // would say "Reconnecting" until someone reloaded the page.
    if (socket.active) {
      onState('reconnecting');
      return;
    }
    // A board's credential cannot be renewed from here. Its link has expired.
    if (boardToken) {
      onState('refused');
      return;
    }
    onState('reconnecting');
    void refreshSession().then((token) => {
      // No token means the session is over, and the client has already sent the
      // person to sign in. A short pause before retrying keeps a server that is
      // refusing everyone from being asked again in a tight loop.
      if (token && !closed) retry = setTimeout(() => socket.connect(), 1000);
    });
  });

  return {
    socket,
    close: () => {
      closed = true;
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.close();
    },
  };
}
