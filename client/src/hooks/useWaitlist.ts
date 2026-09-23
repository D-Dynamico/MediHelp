import { useCallback, useEffect, useState } from 'react';
import type { WaitlistEntryDto } from '@shared/types';
import { WAITLIST_UPDATE_EVENT } from '@shared/types';
import { messageFrom } from '../api/client';
import { openSocket, type SocketState } from '../api/socket';
import { fetchMyWaitlist } from '../api/waitlist';

/**
 * The signed-in patient's waitlist entries, kept live.
 *
 * An offer is pushed to the patient's own room the moment a slot frees up, and
 * the ten minutes start then — so this listens rather than polls. The push
 * carries the one entry that changed; it is merged in place, and a fresh read
 * follows every reconnect, because anything pushed while the connection was
 * down is gone.
 */
export function useWaitlist(enabled: boolean) {
  const [entries, setEntries] = useState<WaitlistEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SocketState | 'connecting'>('connecting');

  const reload = useCallback(async () => {
    try {
      setEntries(await fetchMyWaitlist());
      setError(null);
    } catch (caught) {
      setError(messageFrom(caught, 'Could not load your waitlist.'));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const { socket, close } = openSocket({ onState: setState });

    // Every (re)connect, including the first, re-reads the list. That is the
    // initial load and the catch-up after a drop in one place.
    socket.on('connect', () => void reload());
    socket.on(WAITLIST_UPDATE_EVENT, (entry: WaitlistEntryDto) => {
      setEntries((current) => {
        if (!current) return [entry];
        const others = current.filter((existing) => existing.id !== entry.id);
        // Claimed and withdrawn entries have nothing left to show; the claimed
        // one is now an appointment, which the page reads separately.
        return entry.state === 'claimed' || entry.state === 'withdrawn' ? others : [...others, entry];
      });
    });

    return close;
  }, [enabled, reload]);

  return { entries, error, state, reload, setEntries };
}
