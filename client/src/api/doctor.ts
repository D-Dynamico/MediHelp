import type {
  AppointmentDto,
  DoctorEarningsDto,
  DoctorProfileDto,
  WorkingHoursDto,
} from '@shared/types';
import { api } from './client';

/**
 * The signed-in doctor's own endpoints, typed once.
 *
 * Note that nothing here takes a doctor id. Every one of these routes acts on
 * "whoever is signed in", which the server reads from the token — so there is no
 * id for this module to pass, and none for anyone to tamper with.
 */

/** Which slice of their appointments a doctor is asking for. */
export type AppointmentWhen = 'today' | 'upcoming' | 'past' | 'all';

export interface AppointmentPage {
  items: AppointmentDto[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export async function fetchProfile(): Promise<DoctorProfileDto> {
  const { data } = await api.get<{ profile: DoctorProfileDto }>('/doctor/profile');
  return data.profile;
}

export async function fetchEarnings(): Promise<DoctorEarningsDto> {
  const { data } = await api.get<DoctorEarningsDto>('/doctor/earnings');
  return data;
}

export async function fetchAppointments(
  scope: { when?: AppointmentWhen; page?: number; pageSize?: number } = {},
): Promise<AppointmentPage> {
  const { data } = await api.get<AppointmentPage>('/doctor/appointments', { params: scope });
  return data;
}

/** The three things a doctor can do to a consult of their own. */
export async function actOnAppointment(
  id: string,
  action: 'start' | 'complete' | 'cancel',
): Promise<AppointmentDto> {
  const { data } = await api.patch<{ appointment: AppointmentDto }>(
    `/doctor/appointments/${id}/${action}`,
  );
  return data.appointment;
}

/** What the profile editor can change. Narrower than the admin's form, by design. */
export interface ProfileEdit {
  name: string;
  phone: string;
  about: string;
  fees: string;
  addressLine1: string;
  addressLine2: string;
  available: boolean;
  slotDurationMins: string;
  workingHours: WorkingHoursDto[];
  image?: File;
}

/**
 * Multipart, because it may carry a photo — and so the working hours have to
 * travel as a JSON string. Multipart has no agreed way to carry an array of
 * objects, and the server's schema parses this field back out before validating
 * it row by row.
 */
export async function updateProfile(edit: ProfileEdit): Promise<DoctorProfileDto> {
  const form = new FormData();
  form.append('name', edit.name);
  form.append('phone', edit.phone);
  form.append('about', edit.about);
  form.append('fees', edit.fees);
  form.append('addressLine1', edit.addressLine1);
  form.append('addressLine2', edit.addressLine2);
  form.append('available', String(edit.available));
  form.append('slotDurationMins', edit.slotDurationMins);
  form.append('workingHours', JSON.stringify(edit.workingHours));
  if (edit.image) form.append('image', edit.image);

  const { data } = await api.patch<{ profile: DoctorProfileDto }>('/doctor/profile', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.profile;
}
