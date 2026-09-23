import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { QueueSnapshotDto } from '@shared/types.js';
import { QUEUE_JOIN_EVENT, QUEUE_UPDATE_EVENT } from '@shared/types.js';
import { getSettings } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifyAccessToken, verifyBoardToken } from '../utils/tokens.js';
import { dayFromKey, startOfDayUtc } from '../utils/dates.js';
import { horizonEnd } from '../utils/slots.js';
import { queueJoinSchema } from '../modules/queue/queue.schema.js';

/**
 * The realtime side of the queue.
 *
 * One Socket.IO server on the same HTTP server as the API, so there is one port,
 * one origin and one deployment. Everything it carries is the queue snapshot,
 * which holds nothing but numbers — see `QueueSnapshotDto` for why.
 *
 * Two kinds of caller are allowed in, and they are told apart at the handshake
 * rather than per event:
 *
 * - a **signed-in user**, who sends their access token in `auth.token`. They may
 *   watch any doctor's queue; the payload is the same one on the waiting-room
 *   wall, so there is nothing to scope.
 * - a **board screen**, which sends a board token in `auth.board` and may watch
 *   exactly the one doctor that token names.
 *
 * A connection with neither is refused. Nothing here is a read of private data,
 * but an open socket server is a free amplifier for anyone who wants one.
 */

/** Who is on the other end of a socket. */
type Identity =
  | { kind: 'user'; userId: string }
  /** A wall display. `doctorId` is the only queue it may join. */
  | { kind: 'board'; doctorId: string };

/** The room a doctor's queue for one day broadcasts to. */
export function queueRoom(doctorId: string, dateKey: string): string {
  return `queue:${doctorId}:${dateKey}`;
}

/** The room a single user's own notifications go to — waitlist offers, for one. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

let io: SocketServer | null = null;

/**
 * How a joining screen is given the queue as it stands right now.
 *
 * Passed in rather than imported, because the module that builds a snapshot is
 * the same one that calls `emitQueueUpdate` — importing it here would make the
 * two require each other. It also keeps this file about sockets and nothing
 * else.
 */
export type SnapshotProvider = (
  doctorId: string,
  dateKey: string,
) => Promise<QueueSnapshotDto | null>;

/**
 * Mounts Socket.IO on a running HTTP server.
 *
 * Called from the bootstrap, not from `createApp`, so the check scripts and any
 * test that only wants the Express app get one without a socket server attached.
 * `emitQueueUpdate` is a no-op in that case rather than a crash.
 */
export function mountRealtime(server: HttpServer, snapshotFor?: SnapshotProvider): SocketServer {
  const { CORS_ORIGINS } = getSettings();

  io = new SocketServer(server, {
    path: '/socket.io',
    // Same origin in both environments; the list is only non-empty when the
    // client is deployed somewhere else, and then it must match the API's.
    ...(CORS_ORIGINS.length > 0 ? { cors: { origin: CORS_ORIGINS, credentials: true } } : {}),
  });

  io.use((socket, next) => {
    const auth = socket.handshake.auth as { token?: unknown; board?: unknown };

    try {
      if (typeof auth.token === 'string' && auth.token.length > 0) {
        const payload = verifyAccessToken(auth.token);
        socket.data.identity = { kind: 'user', userId: payload.sub } satisfies Identity;
        next();
        return;
      }

      if (typeof auth.board === 'string' && auth.board.length > 0) {
        const payload = verifyBoardToken(auth.board);
        socket.data.identity = { kind: 'board', doctorId: payload.doctorId } satisfies Identity;
        next();
        return;
      }
    } catch {
      // Deliberately the same message for expired, tampered and wrong-kind, for
      // the same reason `verifyAccessToken` gives only one.
      next(new Error('unauthorized'));
      return;
    }

    next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    const identity = socket.data.identity as Identity;

    // A user's own room is joined for them. Nothing they send can put them in
    // somebody else's, which is the whole point of not making this an event.
    if (identity.kind === 'user') void socket.join(userRoom(identity.userId));

    socket.on(QUEUE_JOIN_EVENT, (payload: unknown) => {
      const parsed = queueJoinSchema.safeParse(payload);
      if (!parsed.success) return;
      const { doctorId, date } = parsed.data;

      // Only days a queue can actually be happening on: yesterday (a clinic
      // running past midnight UTC) through the booking horizon. Every join builds
      // a snapshot, and without a bound one signed-in account could walk every
      // date from year 1 to 9999 through the database for free.
      const day = dayFromKey(date);
      const earliest = startOfDayUtc(new Date(Date.now() - 86_400_000));
      if (day < earliest || day >= horizonEnd()) return;

      // A board link is for one doctor's wall. Without this, one valid link
      // would open every doctor's queue.
      if (identity.kind === 'board' && identity.doctorId !== doctorId) return;

      // One queue at a time per socket, so a client that navigates between
      // doctors does not quietly keep receiving the old one's updates.
      for (const room of socket.rooms) {
        if (room.startsWith('queue:')) void socket.leave(room);
      }
      void socket.join(queueRoom(doctorId, date));

      // The queue as it stands, to this socket alone. Without it a screen shows
      // nothing until the next thing happens — which in a quiet clinic could be
      // twenty minutes of a blank board.
      void snapshotFor?.(doctorId, date).then((snapshot) => {
        if (snapshot) socket.emit(QUEUE_UPDATE_EVENT, snapshot);
      });
    });
  });

  logger.info('Realtime queue mounted on /socket.io');
  return io;
}

/**
 * Broadcasts a queue snapshot to everyone watching that doctor's day.
 *
 * Safe to call when no socket server is mounted — the check scripts drive the
 * queue service directly and must not have to stand one up to do it.
 */
export function emitQueueUpdate(snapshot: QueueSnapshotDto): void {
  io?.to(queueRoom(snapshot.doctorId, snapshot.date)).emit(QUEUE_UPDATE_EVENT, snapshot);
}

/**
 * Sends something to one person, on every device they have open.
 *
 * The user's room is joined for them at connection from their verified token,
 * so this reaches exactly the account named and nobody who merely claims to be
 * it. A no-op when no socket server is mounted, like `emitQueueUpdate`.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

/** For tests and shutdown. */
export function closeRealtime(): void {
  io?.close();
  io = null;
}
