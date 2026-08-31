/**
 * Types and constants shared by the client and the server.
 *
 * Anything in here is a contract between the two sides, so a change means both
 * are rechecked by `npm run typecheck`. Keep it free of imports so it stays
 * usable from either runtime.
 */

/* ---------------------------------------------------------------- roles --- */

export const ROLES = ['patient', 'doctor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/* --------------------------------------------------------- appointments --- */

export const APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that still occupy a slot. A cancelled or no-show slot is bookable. */
export const ACTIVE_APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_progress',
  'completed',
] as const satisfies readonly AppointmentStatus[];

/* -------------------------------------------------------------- payment --- */

export const PAYMENT_MODES = ['cash', 'razorpay'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'pending_at_desk',
  'paid',
  'failed',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* --------------------------------------------------------------- triage --- */

export const URGENCIES = ['routine', 'urgent', 'emergency'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const SPECIALITIES = [
  'General physician',
  'Gynecologist',
  'Dermatologist',
  'Pediatrician',
  'Neurologist',
  'Gastroenterologist',
  'Cardiologist',
  'Orthopedist',
] as const;
export type Speciality = (typeof SPECIALITIES)[number];

/* ------------------------------------------------------------- waitlist --- */

export const WAITLIST_STATES = [
  'waiting',
  'offered',
  'claimed',
  'expired',
  'withdrawn',
] as const;
export type WaitlistState = (typeof WAITLIST_STATES)[number];

/* ------------------------------------------------------------------ api --- */

/** Every error response the API returns takes this shape. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Per-field validation messages, keyed by field path. */
    details?: Record<string, string>;
  };
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
}

/* ----------------------------------------------------------------- dtos --- */

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  image?: string;
}

export interface DoctorDto {
  id: string;
  name: string;
  email: string;
  image?: string;
  speciality: Speciality;
  degree: string;
  experience: number;
  about: string;
  /** In rupees. Always read from the server, never sent by the client. */
  fees: number;
  address: { line1: string; line2?: string };
  available: boolean;
  slotDurationMins: number;
}

/** One sitting on one weekday. 0 = Sunday, matching `Date.getDay()`. */
export interface WorkingHoursDto {
  day: number;
  /** "HH:mm", 24-hour, in the clinic's local time. */
  start: string;
  end: string;
}

/**
 * A doctor's view of their own record. Everything in `DoctorDto` plus the parts
 * only they need: their phone number, the hours they work, and the consult
 * length the queue's wait estimate is built from.
 */
export interface DoctorProfileDto extends DoctorDto {
  phone?: string;
  workingHours: WorkingHoursDto[];
  /** Minutes. Learned from completed consults, not set by hand. */
  medianConsultMins: number;
}

/**
 * A doctor as the admin sees them — the public profile plus the two things only
 * an admin has any business knowing: the phone number and whether the account
 * has been deactivated.
 */
export interface AdminDoctorDto extends DoctorDto {
  phone?: string;
  isActive: boolean;
}

export interface AppointmentDto {
  id: string;
  patient: Pick<UserDto, 'id' | 'name' | 'image'> & { age?: number };
  doctor: Pick<DoctorDto, 'id' | 'name' | 'image' | 'speciality'>;
  slotStart: string;
  slotEnd: string;
  tokenNumber: number;
  status: AppointmentStatus;
  amount: number;
  payment: { mode: PaymentMode; status: PaymentStatus };
  urgency?: Urgency;
}

/** The admin dashboard's headline numbers, from one aggregation. */
export interface AdminDashboardDto {
  counts: { doctors: number; patients: number; appointments: number };
  /** Rupees actually collected — paid appointments only. */
  revenue: number;
  /** Appointments still to happen today. */
  todayUpcoming: number;
  latestBookings: AppointmentDto[];
}

/** A bookable slot returned by the doctor availability endpoint. */
export interface SlotDto {
  start: string;
  end: string;
  available: boolean;
}
