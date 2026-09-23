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

/**
 * Statuses an appointment can still be acted on from — started, completed or
 * cancelled. Shared rather than server-only: the doctor's table decides which
 * buttons a row gets from exactly this list, and a copy of it in the client
 * would quietly stop agreeing the first time a status is added here.
 */
export const OPEN_APPOINTMENT_STATUSES = [
  'booked',
  'checked_in',
  'in_progress',
] as const satisfies readonly AppointmentStatus[];

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

/* --------------------------------------------------------------- people --- */

export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export type Gender = (typeof GENDERS)[number];

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

/**
 * A patient's own account, as they see it. `UserDto` plus the two fields only
 * they and their doctor need: the date of birth an age is shown from, and how
 * they would like to be referred to.
 */
export interface PatientProfileDto extends UserDto {
  /** A plain calendar date, "YYYY-MM-DD" — no time, because none was given. */
  dob?: string;
  gender?: Gender;
}

/**
 * A doctor as an unauthenticated visitor sees them: `DoctorDto` without the
 * email address.
 *
 * The catalogue is open to anyone, and a doctor's email is their login. A public
 * list of every staff login address is the first half of a password-stuffing
 * run, and a patient choosing a dermatologist has no use for it.
 */
export type PublicDoctorDto = Omit<DoctorDto, 'email'>;

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

/** What a doctor has earned, and off how much work. */
export interface DoctorEarningsDto {
  /** Rupees collected across every completed, paid consult. */
  total: number;
  /** The same, for the calendar month in progress. */
  thisMonth: number;
  /** Completed consults, all time. */
  appointments: number;
  /** Distinct people seen, all time — not the same as the consult count. */
  patients: number;
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
  /** From the triage assessment the booking came through, when it did. */
  urgency?: Urgency;
  /** The summary written for the doctor to read before the consult. */
  intakeNote?: string;
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

/**
 * One symptom assessment, as every triage surface sees it.
 *
 * `recommendedSpeciality` is absent for an emergency — the answer there is not
 * an appointment, and the UI shows advice instead of a booking form. It is a
 * suggestion in every other case: the patient can still book anyone.
 */
export interface TriageDto {
  id: string;
  urgency: Urgency;
  recommendedSpeciality?: Speciality;
  intakeNote: string;
  questionsToAsk: string[];
  /** What to do instead of booking. Present only for an emergency. */
  emergencyAdvice?: string;
  structured: {
    durationText?: string;
    severity?: 'mild' | 'moderate' | 'severe';
    redFlags: string[];
  };
  /** Which engine produced this. `rules` is the offline default and the fallback. */
  source: 'rules' | 'llm';
  createdAt: string;
}

/* ---------------------------------------------------------------- queue --- */

/**
 * The queue as **anyone in the room may see it** — the waiting-room board, and
 * every patient waiting for this doctor today.
 *
 * Deliberately nothing but numbers. The room behind `queue:update` is joined by
 * every patient of the doctor and by an unauthenticated board screen, so a
 * payload carrying names would put the day's patient list on a wall and in the
 * hands of anyone holding a board link. The doctor's own screen needs names, so
 * it reads them over its authenticated endpoint and uses this only as the
 * signal that something changed.
 */
export interface QueueSnapshotDto {
  doctorId: string;
  doctorName: string;
  speciality: Speciality;
  /** The day this queue belongs to, "YYYY-MM-DD" in UTC. */
  date: string;
  /**
   * The token being seen now, or the last one called if the room is empty
   * between patients. 0 means nobody has been called today.
   */
  currentToken: number;
  /**
   * Whether `currentToken` is in the room right now, or has already left it.
   * Without this a patient whose consult just finished would keep reading "the
   * doctor is ready for you" until the next patient was called.
   */
  inRoom: boolean;
  /** Tokens checked in and still waiting, in the order they will be called. */
  waiting: number[];
  /** Minutes a consult typically takes for this doctor — what the ETA is built on. */
  medianConsultMins: number;
  /** When the server made this snapshot. */
  updatedAt: string;
}

/** One person in the doctor's own view of their queue. */
export interface QueueEntryDto {
  appointmentId: string;
  tokenNumber: number;
  patientName: string;
  patientImage?: string;
  slotStart: string;
  status: AppointmentStatus;
  /** Whole minutes since the patient checked in. Absent until they have. */
  waitingMins?: number;
  /** From the triage assessment the booking came through, when it did. */
  urgency?: Urgency;
}

/** The doctor's queue screen: the shared snapshot plus the names behind it. */
export interface DoctorQueueDto {
  snapshot: QueueSnapshotDto;
  /** Everyone on today's list, in token order — waiting, being seen and done. */
  entries: QueueEntryDto[];
}

/** A shareable link that opens the waiting-room board without a login. */
export interface BoardLinkDto {
  /** The path to open, board token included. */
  path: string;
  expiresAt: string;
}

/** The one event the queue room carries. Named here so both sides agree. */
export const QUEUE_UPDATE_EVENT = 'queue:update';
export const QUEUE_JOIN_EVENT = 'queue:join';

