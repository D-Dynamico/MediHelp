import axios from 'axios';
import type { AppointmentDto, BoardLinkDto, DoctorQueueDto, QueueSnapshotDto } from '@shared/types';
import { api } from './client';

/**
 * The live queue's endpoints.
 *
 * Two audiences, and they do not share a client. The doctor's calls go through
 * `api`, which carries the access token and refreshes it. The board's call is a
 * bare axios request with a signed link and no credentials at all — putting it
 * through `api` would have it try to refresh a session the wall display does
 * not have, and send it to the login page when that failed.
 */

export async function fetchQueue(date?: string): Promise<DoctorQueueDto> {
  const { data } = await api.get<DoctorQueueDto>('/doctor/queue', {
    params: date ? { date } : {},
  });
  return data;
}

export async function checkInPatient(appointmentId: string): Promise<DoctorQueueDto> {
  const { data } = await api.post<DoctorQueueDto>(`/doctor/queue/${appointmentId}/check-in`);
  return data;
}

export async function callNextPatient(date?: string): Promise<DoctorQueueDto> {
  const { data } = await api.post<DoctorQueueDto>('/doctor/queue/call-next', null, {
    params: date ? { date } : {},
  });
  return data;
}

interface QueueAction {
  appointment: AppointmentDto;
  queue: DoctorQueueDto;
}

export async function completeConsult(appointmentId: string): Promise<QueueAction> {
  const { data } = await api.post<QueueAction>(`/doctor/queue/${appointmentId}/complete`);
  return data;
}

export async function markNoShow(appointmentId: string): Promise<QueueAction> {
  const { data } = await api.post<QueueAction>(`/doctor/queue/${appointmentId}/no-show`);
  return data;
}

export async function fetchBoardLink(): Promise<BoardLinkDto> {
  const { data } = await api.get<{ link: BoardLinkDto }>('/doctor/queue/board-link');
  return data.link;
}

/** The wall display's own read. No session, no cookie — the signed link only. */
export async function fetchBoard(doctorId: string, token: string): Promise<QueueSnapshotDto> {
  const { data } = await axios.get<{ snapshot: QueueSnapshotDto }>(`/api/board/${doctorId}`, {
    params: { t: token },
  });
  return data.snapshot;
}
