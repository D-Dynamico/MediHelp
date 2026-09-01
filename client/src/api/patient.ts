import type {
  AppointmentDto,
  PatientProfileDto,
  PaymentMode,
  PublicDoctorDto,
  SlotDto,
  Speciality,
} from '@shared/types';
import { api } from './client';

/**
 * The catalogue and the patient's own endpoints, typed once.
 *
 * The catalogue calls go out without a token and work fine signed out — that is
 * the point of them. Everything under `/patient` and `/appointments` is scoped
 * to the signed-in account by the server, so none of these takes a patient id.
 */

export interface AppointmentPage {
  items: AppointmentDto[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface DoctorFilters {
  speciality?: Speciality;
  search?: string;
}

export async function fetchDoctors(filters: DoctorFilters = {}): Promise<PublicDoctorDto[]> {
  const { data } = await api.get<{ doctors: PublicDoctorDto[] }>('/doctors', {
    params: definedOnly(filters),
  });
  return data.doctors;
}

export async function fetchDoctor(id: string): Promise<PublicDoctorDto> {
  const { data } = await api.get<{ doctor: PublicDoctorDto }>(`/doctors/${id}`);
  return data.doctor;
}

/** `date` is a plain "YYYY-MM-DD" day, which is what the server asks for. */
export async function fetchSlots(id: string, date: string): Promise<SlotDto[]> {
  const { data } = await api.get<{ date: string; slots: SlotDto[] }>(`/doctors/${id}/slots`, {
    params: { date },
  });
  return data.slots;
}

/**
 * Books a slot.
 *
 * Note there is no amount here. The fee is read from the doctor record on the
 * server, so there is nothing for this call to get wrong or for anyone to
 * tamper with on the way.
 */
export async function bookAppointment(input: {
  doctorId: string;
  slotStart: string;
  mode: PaymentMode;
  triageId?: string;
}): Promise<AppointmentDto> {
  const { data } = await api.post<{ appointment: AppointmentDto }>('/appointments', input);
  return data.appointment;
}

export async function fetchMyAppointments(
  query: { when?: 'upcoming' | 'past' | 'all'; page?: number; pageSize?: number } = {},
): Promise<AppointmentPage> {
  const { data } = await api.get<AppointmentPage>('/appointments/mine', { params: query });
  return data;
}

export async function cancelMyAppointment(id: string): Promise<AppointmentDto> {
  const { data } = await api.patch<{ appointment: AppointmentDto }>(`/appointments/${id}/cancel`);
  return data.appointment;
}

export async function fetchMyProfile(): Promise<PatientProfileDto> {
  const { data } = await api.get<{ profile: PatientProfileDto }>('/patient/profile');
  return data.profile;
}

/**
 * Multipart, because it may carry a photo. Empty values are dropped rather than
 * sent: the server reads an absent field as "not changed", and sending a blank
 * date of birth would be a validation failure for a box the patient simply left
 * alone.
 */
export async function updateMyProfile(
  input: Record<string, string | Blob | undefined>,
): Promise<PatientProfileDto> {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') form.append(key, value);
  }

  const { data } = await api.patch<{ profile: PatientProfileDto }>('/patient/profile', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.profile;
}

/** Drops empty values before they reach the query string. */
function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}
