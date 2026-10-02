import { UserModel } from './User.js';
import { DoctorModel } from './Doctor.js';
import { AppointmentModel } from './Appointment.js';
import { RefreshTokenModel } from './RefreshToken.js';
import { PaymentModel } from './Payment.js';
import { AuditLogModel } from './AuditLog.js';
import { TriageAssessmentModel } from './TriageAssessment.js';
import { QueueSessionModel } from './QueueSession.js';
import { WaitlistModel } from './Waitlist.js';

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

/**
 * Builds every index the schemas declare that the database does not have yet.
 * Never drops one, so it is safe to run against a live database at any time.
 *
 * Needed because `connectDb` turns Mongoose's automatic index building off in
 * production. Without this, a database set up in production has none of them,
 * and loses what they enforce: one active booking per slot, one account per
 * email, refresh tokens that expire on their own. The live database was first
 * seeded exactly like that.
 */
export async function ensureIndexes(): Promise<void> {
  const models = [
    UserModel,
    DoctorModel,
    AppointmentModel,
    RefreshTokenModel,
    PaymentModel,
    AuditLogModel,
    TriageAssessmentModel,
    QueueSessionModel,
    WaitlistModel,
  ];
  // One at a time: a shared Atlas tier would rather not build nine at once.
  for (const model of models) await model.createIndexes();
}

export type { User, UserDocument } from './User.js';
export type { Doctor, DoctorDocument, WorkingHours } from './Doctor.js';
export type { Appointment, AppointmentDocument } from './Appointment.js';
export type { RefreshToken, RefreshTokenDocument } from './RefreshToken.js';
export type { Payment, PaymentDocument } from './Payment.js';
export type { AuditLog, AuditLogDocument } from './AuditLog.js';
export type { TriageAssessment, TriageAssessmentDocument } from './TriageAssessment.js';
export type { QueueSession, QueueSessionDocument } from './QueueSession.js';
export type { Waitlist, WaitlistDocument } from './Waitlist.js';
