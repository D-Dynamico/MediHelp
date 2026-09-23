import type { AppointmentDto, WaitlistEntryDto } from '@shared/types';
import { api } from './client';

/** The signed-in patient's waitlist. Nothing here names a patient: it is always "me". */

export async function fetchMyWaitlist(): Promise<WaitlistEntryDto[]> {
  const { data } = await api.get<{ entries: WaitlistEntryDto[] }>('/waitlist');
  return data.entries;
}

export async function joinWaitlist(doctorId: string, date: string): Promise<WaitlistEntryDto> {
  const { data } = await api.post<{ entry: WaitlistEntryDto }>('/waitlist', { doctorId, date });
  return data.entry;
}

/** Leaves the list — or, on an open offer, lets the offered slot go to the next person. */
export async function leaveWaitlist(entryId: string): Promise<WaitlistEntryDto> {
  const { data } = await api.delete<{ entry: WaitlistEntryDto }>(`/waitlist/${entryId}`);
  return data.entry;
}

/**
 * Claims an offered slot.
 *
 * Always as "pay at the clinic". The offer window is ten minutes, which is no
 * time to send somebody through a payment gateway that might stall — the slot
 * is what they are racing for, and the money can wait for the desk.
 */
export async function claimOffer(
  entryId: string,
): Promise<{ appointment: AppointmentDto; entry: WaitlistEntryDto }> {
  const { data } = await api.post<{ appointment: AppointmentDto; entry: WaitlistEntryDto }>(
    `/waitlist/${entryId}/claim`,
    { mode: 'cash' },
  );
  return data;
}
