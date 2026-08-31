import type {
  AdminDashboardDto,
  AdminDoctorDto,
  AppointmentDto,
  AppointmentStatus,
  Speciality,
} from '@shared/types';
import { api } from './client';

/**
 * The admin endpoints, typed once.
 *
 * Components call these rather than `api.get` directly, so a change to a route
 * or a response shape is a compiler error in one file instead of a runtime
 * surprise spread across five screens.
 */

export interface AppointmentPage {
  items: AppointmentDto[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface AppointmentFilters {
  status?: AppointmentStatus;
  doctorId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchDashboard(): Promise<AdminDashboardDto> {
  const { data } = await api.get<AdminDashboardDto>('/admin/dashboard');
  return data;
}

export async function fetchDoctors(
  filters: { speciality?: Speciality; search?: string; includeInactive?: boolean } = {},
): Promise<AdminDoctorDto[]> {
  const { data } = await api.get<{ doctors: AdminDoctorDto[] }>('/admin/doctors', {
    params: definedOnly(filters),
  });
  return data.doctors;
}

/**
 * Multipart, because it may carry a photo. The fields are appended one by one
 * rather than from a `FormData(form)`: the server takes a flat address and only
 * the fields it declares, and building it here keeps that contract visible.
 */
export async function createDoctor(input: Record<string, string | Blob | undefined>) {
  const { data } = await api.post<{ doctor: AdminDoctorDto }>('/admin/doctors', toFormData(input), {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.doctor;
}

export async function updateDoctor(
  id: string,
  input: Record<string, string | Blob | undefined>,
): Promise<AdminDoctorDto> {
  const { data } = await api.patch<{ doctor: AdminDoctorDto }>(
    `/admin/doctors/${id}`,
    toFormData(input),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data.doctor;
}

export async function removeDoctor(id: string): Promise<AdminDoctorDto> {
  const { data } = await api.delete<{ doctor: AdminDoctorDto }>(`/admin/doctors/${id}`);
  return data.doctor;
}

export async function fetchAppointments(filters: AppointmentFilters = {}): Promise<AppointmentPage> {
  const { data } = await api.get<AppointmentPage>('/admin/appointments', {
    params: definedOnly(filters),
  });
  return data;
}

export async function cancelAppointment(id: string): Promise<AppointmentDto> {
  const { data } = await api.patch<{ appointment: AppointmentDto }>(
    `/admin/appointments/${id}/cancel`,
  );
  return data.appointment;
}

export async function completeAppointment(id: string): Promise<AppointmentDto> {
  const { data } = await api.patch<{ appointment: AppointmentDto }>(
    `/admin/appointments/${id}/complete`,
  );
  return data.appointment;
}

/**
 * Drops empty values before they reach the query string. An empty `search=`
 * would be a real filter server-side — one that matches everything, but still a
 * regex build and a different query plan for no reason.
 */
function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

function toFormData(input: Record<string, string | Blob | undefined>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') form.append(key, value);
  }
  return form;
}
