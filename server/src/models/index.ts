/** One import site for the models, so scripts and services do not chase paths. */
export { UserModel, MAX_FAILED_LOGINS, LOCK_DURATION_MS } from './User.js';
export { DoctorModel, DEFAULT_SLOT_MINUTES, DEFAULT_MEDIAN_CONSULT_MINUTES } from './Doctor.js';
export { AppointmentModel } from './Appointment.js';
export { RefreshTokenModel } from './RefreshToken.js';
export { PaymentModel } from './Payment.js';
export { AuditLogModel } from './AuditLog.js';
export { TriageAssessmentModel } from './TriageAssessment.js';
export { QueueSessionModel } from './QueueSession.js';
export { WaitlistModel, OFFER_WINDOW_MS } from './Waitlist.js';

export type { User, UserDocument } from './User.js';
export type { Doctor, DoctorDocument, WorkingHours } from './Doctor.js';
export type { Appointment, AppointmentDocument } from './Appointment.js';
export type { RefreshToken, RefreshTokenDocument } from './RefreshToken.js';
export type { Payment, PaymentDocument } from './Payment.js';
export type { AuditLog, AuditLogDocument } from './AuditLog.js';
export type { TriageAssessment, TriageAssessmentDocument } from './TriageAssessment.js';
export type { QueueSession, QueueSessionDocument } from './QueueSession.js';
export type { Waitlist, WaitlistDocument } from './Waitlist.js';
