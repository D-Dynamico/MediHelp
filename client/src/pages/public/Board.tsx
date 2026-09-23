import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { QueueSnapshotDto } from '@shared/types';
import { fetchBoard } from '../../api/queue';
import { useQueue } from '../../hooks/useQueue';

/**
 * The waiting-room wall.
 *
 * No shell, no header, no nav, nothing to click. It is read across a room off a
 * bright screen by people who did not choose to look at it, so it is one dark
 * surface with a fixed palette that does not follow the app's theme, and the
 * only thing on it at any size is the number being called.
 *
 * Its credential is the signed link in its own address bar. The first read goes
 * over HTTP so a bad or expired link can say so in words; after that the socket
 * keeps it current and the HTTP answer is never used again.
 */
export function Board() {
  const { doctorId = '' } = useParams();
  const [params] = useSearchParams();
  const boardToken = params.get('t') ?? '';

  const [initial, setInitial] = useState<QueueSnapshotDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doctorId || !boardToken) {
      setError('This board link is incomplete.');
      return;
    }
    fetchBoard(doctorId, boardToken)
      .then(setInitial)
      .catch(() => setError('This board link is not valid any more. Ask for a new one.'));
  }, [doctorId, boardToken]);

  const { snapshot: live, status } = useQueue(error ? null : doctorId || null, { boardToken });
  const snapshot = live ?? initial;

  // The link worked when the page opened and has since run out — boards stay on
  // for weeks, and links last thirty days. Saying so is the only way anybody
  // finds out why the wall stopped moving.
  const shownError =
    error ?? (status === 'refused' ? 'This board link has expired. Ask for a new one.' : null);

  // A board that has lost touch dims rather than freezes: the numbers are still
  // the last thing that was true, and a waiting room reads a dimmed board as
  // "wait" rather than as "this is current".
  const stale = status !== 'live';

  return (
    <div className="flex min-h-screen flex-col bg-board-bg px-8 py-10 text-board-ink">
      {stale && !shownError && (
        <div className="mb-6 rounded-sm bg-warning-solid px-4 py-2 text-center text-h3 font-medium text-white">
          Reconnecting
        </div>
      )}

      {shownError ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-h1 text-board-muted">{shownError}</p>
        </div>
      ) : !snapshot ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-h1 text-board-muted">Loading the queue…</p>
        </div>
      ) : (
        <BoardColumn snapshot={snapshot} dimmed={stale} />
      )}

      <p className="mt-8 text-center text-h3 text-board-muted">
        MediHelp
        {snapshot && ` · Updated ${new Date(snapshot.updatedAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })}`}
      </p>
    </div>
  );
}

/**
 * One doctor's column.
 *
 * A component rather than inline markup because the board is specified as one
 * column per doctor; the route names a single doctor today, and a multi-doctor
 * wall is then a list of these rather than a rewrite.
 */
function BoardColumn({ snapshot, dimmed }: { snapshot: QueueSnapshotDto; dimmed: boolean }) {
  const next = snapshot.waiting.slice(0, 3);

  return (
    <div
      // The 200ms crossfade the design asks for, and nothing else moves. Motion
      // on a wall display is read from the corner of an eye as "something
      // happened", so it is spent only on the number changing.
      className={`flex flex-1 flex-col items-center justify-center gap-6 transition-opacity duration-200 ${
        dimmed ? 'opacity-60' : 'opacity-100'
      }`}
    >
      <p className="text-h2 text-board-muted">
        {snapshot.doctorName} · {snapshot.speciality}
      </p>

      {snapshot.currentToken > 0 ? (
        <>
          <p className="text-h3 uppercase tracking-widest text-board-muted">Now serving</p>
          <p
            key={snapshot.currentToken}
            className="animate-fade-in text-display font-semibold tabular-nums text-board-accent lg:text-[6rem] lg:leading-none"
          >
            T-{snapshot.currentToken}
          </p>
        </>
      ) : (
        <p className="text-h1 text-board-muted">No one has been called yet</p>
      )}

      {next.length > 0 ? (
        <div className="mt-4 text-center">
          <p className="text-h3 uppercase tracking-widest text-board-muted">Next</p>
          <p className="mt-2 flex flex-wrap justify-center gap-6 text-h1 tabular-nums text-board-muted">
            {next.map((token) => (
              <span key={token}>T-{token}</span>
            ))}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-h2 text-board-muted">No one waiting</p>
      )}
    </div>
  );
}
